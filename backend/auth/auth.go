// Package auth holds the security primitives: random tokens, their hashes,
// and the GitHub OAuth web flow.
//
// Why GitHub: the audience is engineers (everyone has an account), it needs
// no email delivery or password storage, and the OAuth app is free to create.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// NewToken returns 32 random bytes, URL-safe base64 encoded (256 bits of entropy).
func NewToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// Hash is what we store instead of a token: SHA-256 is enough because tokens
// are long and random (no dictionary to brute-force), unlike passwords.
func Hash(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// Equal compares secrets in constant time.
func Equal(a, b string) bool { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }

// GitHubUser is the subset of the GitHub profile we keep.
type GitHubUser struct {
	ID        int64  `json:"id"`
	Login     string `json:"login"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	// Email is the primary, verified address (needs the user:email scope); "" if unavailable.
	Email string `json:"-"`
}

// GitHub implements the OAuth web application flow. Endpoints are fields so
// tests can point them at a fake server.
type GitHub struct {
	ClientID     string
	ClientSecret string
	AuthorizeURL string
	TokenURL     string
	APIURL       string
	HTTP         *http.Client
}

// NewGitHub returns a client for github.com.
func NewGitHub(clientID, clientSecret string) *GitHub {
	return &GitHub{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		AuthorizeURL: "https://github.com/login/oauth/authorize",
		TokenURL:     "https://github.com/login/oauth/access_token",
		APIURL:       "https://api.github.com",
		HTTP:         &http.Client{Timeout: 10 * time.Second},
	}
}

// Configured reports whether credentials are present.
func (g *GitHub) Configured() bool { return g != nil && g.ClientID != "" && g.ClientSecret != "" }

// Scope asks only for the profile plus email addresses (read-only), so email
// reminders go to an address GitHub has verified. Nothing else is accessible.
const Scope = "user:email"

// AuthCodeURL is where the browser goes to approve the app.
func (g *GitHub) AuthCodeURL(state, redirectURI string) string {
	q := url.Values{}
	q.Set("client_id", g.ClientID)
	q.Set("scope", Scope)
	q.Set("redirect_uri", redirectURI)
	q.Set("state", state)
	q.Set("allow_signup", "true")
	return g.AuthorizeURL + "?" + q.Encode()
}

// ErrOAuth wraps any failure talking to GitHub.
var ErrOAuth = errors.New("github sign-in failed")

// Exchange trades the callback code for the user's profile. The access token
// is used once and discarded: we never call GitHub on the user's behalf again.
func (g *GitHub) Exchange(ctx context.Context, code, redirectURI string) (GitHubUser, error) {
	form := url.Values{}
	form.Set("client_id", g.ClientID)
	form.Set("client_secret", g.ClientSecret)
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return GitHubUser{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	var token struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
		Description string `json:"error_description"`
	}
	if err := g.do(req, &token); err != nil {
		return GitHubUser{}, err
	}
	if token.AccessToken == "" {
		return GitHubUser{}, fmt.Errorf("%w: %s %s", ErrOAuth, token.Error, token.Description)
	}

	req, err = http.NewRequestWithContext(ctx, http.MethodGet, g.APIURL+"/user", nil)
	if err != nil {
		return GitHubUser{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token.AccessToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	var user GitHubUser
	if err := g.do(req, &user); err != nil {
		return GitHubUser{}, err
	}
	if user.ID == 0 || user.Login == "" {
		return GitHubUser{}, fmt.Errorf("%w: empty profile", ErrOAuth)
	}
	user.Email = g.primaryEmail(ctx, token.AccessToken)
	return user, nil
}

// primaryEmail returns the user's primary verified address, or "" (scope not
// granted, API error): reminders are optional, so this never fails sign-in.
func (g *GitHub) primaryEmail(ctx context.Context, accessToken string) string {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, g.APIURL+"/user/emails", nil)
	if err != nil {
		return ""
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	var emails []struct {
		Email    string `json:"email"`
		Primary  bool   `json:"primary"`
		Verified bool   `json:"verified"`
	}
	if err := g.do(req, &emails); err != nil {
		return ""
	}
	for _, e := range emails {
		if e.Primary && e.Verified {
			return e.Email
		}
	}
	return ""
}

func (g *GitHub) do(req *http.Request, into any) error {
	res, err := g.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrOAuth, err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("%w: %v", ErrOAuth, err)
	}
	if res.StatusCode >= 300 {
		return fmt.Errorf("%w: %s returned %d", ErrOAuth, req.URL.Path, res.StatusCode)
	}
	if err := json.Unmarshal(body, into); err != nil {
		return fmt.Errorf("%w: %v", ErrOAuth, err)
	}
	return nil
}
