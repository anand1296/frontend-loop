package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/anand1296/frontend-loop/backend/auth"
	"github.com/anand1296/frontend-loop/backend/store"
)

const (
	sessionTTL     = 30 * 24 * time.Hour
	oauthCookieTTL = 10 * time.Minute
)

type ctxKey int

const userKey ctxKey = 1

// secure reports whether cookies get the Secure flag (everything except plain-http localhost).
func (s *Server) secure(r *http.Request) bool {
	return strings.HasPrefix(s.origin(r), "https://")
}

// sessionCookieName uses the __Host- prefix on HTTPS: the browser then refuses
// the cookie unless it is Secure, host-only and Path=/, so a sibling subdomain
// can't plant or overwrite it.
func (s *Server) sessionCookieName(r *http.Request) string {
	if s.secure(r) {
		return "__Host-fl_session"
	}
	return "fl_session"
}

func (s *Server) setCookie(w http.ResponseWriter, r *http.Request, name, value string, maxAge time.Duration) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		MaxAge:   int(maxAge.Seconds()),
		HttpOnly: true,
		Secure:   s.secure(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) clearCookie(w http.ResponseWriter, r *http.Request, name string) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.secure(r), SameSite: http.SameSiteLaxMode})
}

// withSession resolves the session cookie (if any) into a user on the request context.
func (s *Server) withSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(s.sessionCookieName(r))
		if err == nil && cookie.Value != "" && len(cookie.Value) < 200 {
			user, err := s.store.SessionUser(r.Context(), auth.Hash(cookie.Value), s.now())
			switch {
			case err == nil:
				r = r.WithContext(context.WithValue(r.Context(), userKey, user))
			case errors.Is(err, store.ErrNotFound):
				s.clearCookie(w, r, s.sessionCookieName(r)) // expired or revoked
			default:
				s.storeError(w, r, err)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func currentUser(r *http.Request) (store.User, bool) {
	user, ok := r.Context().Value(userKey).(store.User)
	return user, ok
}

type handlerWithUser func(w http.ResponseWriter, r *http.Request, user store.User)

func (s *Server) signedIn(h handlerWithUser) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := currentUser(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "signed_out", "Please sign in.")
			return
		}
		h(w, r, user)
	}
}

func (s *Server) adminOnly(h handlerWithUser) http.HandlerFunc {
	return s.signedIn(func(w http.ResponseWriter, r *http.Request, user store.User) {
		if !user.IsAdmin() {
			writeError(w, http.StatusForbidden, "forbidden", "Admins only.")
			return
		}
		h(w, r, user)
	})
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, user store.User) error {
	token, err := auth.NewToken()
	if err != nil {
		return err
	}
	if err := s.store.CreateSession(r.Context(), user.ID, auth.Hash(token), s.now().Add(sessionTTL)); err != nil {
		return err
	}
	s.setCookie(w, r, s.sessionCookieName(r), token, sessionTTL)
	return nil
}

/* ---------------------------------------------------------------- GitHub OAuth */

type oauthState struct {
	State  string `json:"s"`
	Invite string `json:"i,omitempty"`
	Next   string `json:"n,omitempty"`
}

// safeNext only allows returning to an in-app hash route, never another site (no open redirect).
var safeNext = regexp.MustCompile(`^#[A-Za-z0-9_-]{0,100}$`)

func (s *Server) githubStart(w http.ResponseWriter, r *http.Request) {
	if !s.github.Configured() {
		writeError(w, http.StatusServiceUnavailable, "github_unconfigured", "GitHub sign-in is not configured on this deployment.")
		return
	}
	if !s.limiter.allow("auth:"+s.clientIP(r), 20, time.Minute) {
		writeError(w, http.StatusTooManyRequests, "rate_limited", "Too many sign-in attempts. Wait a minute.")
		return
	}
	state, err := auth.NewToken()
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	st := oauthState{State: state, Invite: r.URL.Query().Get("invite")}
	if next := r.URL.Query().Get("next"); safeNext.MatchString(next) {
		st.Next = next
	}
	raw, _ := json.Marshal(st)
	s.setCookie(w, r, "fl_oauth", base64.RawURLEncoding.EncodeToString(raw), oauthCookieTTL)
	http.Redirect(w, r, s.github.AuthCodeURL(state, s.origin(r)+"/api/auth/github/callback"), http.StatusFound)
}

func (s *Server) finishRedirect(w http.ResponseWriter, r *http.Request, errCode, next string) {
	target := s.origin(r) + "/"
	if errCode != "" {
		target += "?auth_error=" + url.QueryEscape(errCode)
	}
	http.Redirect(w, r, target+next, http.StatusFound)
}

func (s *Server) githubCallback(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("fl_oauth")
	s.clearCookie(w, r, "fl_oauth")
	if err != nil {
		s.finishRedirect(w, r, "expired", "")
		return
	}
	raw, err := base64.RawURLEncoding.DecodeString(cookie.Value)
	var st oauthState
	if err != nil || json.Unmarshal(raw, &st) != nil || st.State == "" || !auth.Equal(st.State, r.URL.Query().Get("state")) {
		s.finishRedirect(w, r, "state", "")
		return
	}
	if r.URL.Query().Get("error") != "" {
		s.finishRedirect(w, r, "denied", st.Next)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	profile, err := s.github.Exchange(ctx, r.URL.Query().Get("code"), s.origin(r)+"/api/auth/github/callback")
	if err != nil {
		s.log.WarnContext(r.Context(), "github exchange failed", "err", err)
		s.finishRedirect(w, r, "github", st.Next)
		return
	}
	identity := store.Identity{GitHubID: profile.ID, Login: profile.Login, Name: profile.Name, AvatarURL: profile.AvatarURL, Email: profile.Email}
	if code := s.completeSignIn(w, r, identity, st.Invite); code != "" {
		s.finishRedirect(w, r, code, st.Next)
		return
	}
	s.finishRedirect(w, r, "", st.Next)
}

// completeSignIn applies the sign-in policy and starts a session. It returns an error code or "".
func (s *Server) completeSignIn(w http.ResponseWriter, r *http.Request, identity store.Identity, invite string) string {
	site := s.siteSettings(r.Context())
	opts := store.SignInOptions{OwnerLogin: s.cfg.OwnerLogin, OpenSignups: site.Registration == "open", Now: s.now()}
	if invite != "" {
		opts.InviteHash = auth.Hash(invite)
	}
	user, err := s.store.SignIn(r.Context(), identity, opts)
	switch {
	case errors.Is(err, store.ErrNotInvited):
		return "not_invited"
	case errors.Is(err, store.ErrDisabled):
		return "disabled"
	case err != nil:
		s.log.ErrorContext(r.Context(), "sign-in failed", "err", err)
		return "server"
	}
	if err := s.startSession(w, r, user); err != nil {
		s.log.ErrorContext(r.Context(), "session failed", "err", err)
		return "server"
	}
	return ""
}

// devLogin signs in as any login without GitHub. Only when DEV_LOGIN=1 outside production.
func (s *Server) devLogin(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.DevLogin {
		writeError(w, http.StatusNotFound, "not_found", "No such API endpoint.")
		return
	}
	var body struct {
		Login  string `json:"login"`
		Name   string `json:"name"`
		Invite string `json:"invite"`
		Email  string `json:"email"`
	}
	if !decode(w, r, &body) {
		return
	}
	login := strings.ToLower(strings.TrimSpace(body.Login))
	if !regexp.MustCompile(`^[a-z0-9-]{1,39}$`).MatchString(login) {
		writeError(w, http.StatusBadRequest, "invalid", "login must look like a GitHub username")
		return
	}
	name := body.Name
	if name == "" {
		name = login
	}
	if code := s.completeSignIn(w, r, store.Identity{Login: login, Name: name, Email: body.Email}, body.Invite); code != "" {
		writeError(w, http.StatusForbidden, code, "Sign-in refused: "+code)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(s.sessionCookieName(r)); err == nil {
		_ = s.store.DeleteSession(r.Context(), auth.Hash(cookie.Value))
	}
	s.clearCookie(w, r, s.sessionCookieName(r))
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
