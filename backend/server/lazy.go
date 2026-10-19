package server

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/anand1296/whetstone/backend/catalog"
	"github.com/anand1296/whetstone/backend/store"
)

// Lazy builds the real handler on first use and retries failed starts.
// sync.Once would cache a failure forever; here a failed start is retried
// at most every few seconds.
type Lazy struct {
	cfg     Config
	log     *slog.Logger
	mu      sync.Mutex
	handler http.Handler
	lastTry time.Time
	lastErr error
}

// NewLazy returns a handler that connects on first request.
func NewLazy(cfg Config) *Lazy {
	return &Lazy{cfg: cfg, log: slog.New(slog.NewJSONHandler(os.Stdout, nil))}
}

func (l *Lazy) get(ctx context.Context) (http.Handler, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.handler != nil {
		return l.handler, nil
	}
	if l.lastErr != nil && time.Since(l.lastTry) < 3*time.Second {
		return nil, l.lastErr
	}
	l.lastTry = time.Now()
	h, err := Build(ctx, l.cfg, l.log)
	l.lastErr = err
	if err == nil {
		l.handler = h
	} else {
		l.log.Error("startup failed", "err", err)
	}
	return h, err
}

// SetupStatus says which pieces of configuration are present. Booleans only:
// it never reveals a value, so it is safe to serve to anyone.
type SetupStatus struct {
	Database bool `json:"database"`
	GitHub   bool `json:"github"`
	Owner    bool `json:"owner"`
	AppURL   bool `json:"appUrl"`
}

// Setup reports the configuration checklist for this deployment.
func (c Config) Setup() SetupStatus {
	return SetupStatus{
		Database: c.DatabaseURL != "",
		GitHub:   c.GitHubClientID != "" && c.GitHubClientSecret != "",
		Owner:    c.OwnerLogin != "",
		AppURL:   c.PublicURL != "",
	}
}

func writeSetup(w http.ResponseWriter, code, message string, setup SetupStatus) {
	writeJSON(w, http.StatusServiceUnavailable, map[string]any{
		"error": apiError{Code: code, Message: message},
		"setup": setup,
	})
}

func (l *Lazy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if l.cfg.DatabaseURL == "" {
		// Deployed without a database: the frontend shows a setup checklist
		// (and lets people study offline meanwhile) instead of failing.
		writeSetup(w, "not_configured", "This deployment has no database yet: set DATABASE_URL (see docs/DEPLOYMENT.md).", l.cfg.Setup())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	h, err := l.get(ctx)
	if err != nil {
		writeSetup(w, "unavailable", "The backend can't reach its database right now. Try again in a moment.", l.cfg.Setup())
		return
	}
	h.ServeHTTP(w, r)
}

// Build connects, migrates, seeds and returns the API handler.
func Build(ctx context.Context, cfg Config, log *slog.Logger) (http.Handler, error) {
	st, err := store.Open(ctx, cfg.DatabaseURL, cfg.MaxDBConns)
	if err != nil {
		return nil, err
	}
	compiler := catalog.NewCompiler()
	repo, err := Prepare(ctx, st, compiler)
	if err != nil {
		_ = st.Close()
		return nil, err
	}
	if cfg.OwnerLogin == "" {
		log.Warn("OWNER_GITHUB_LOGIN is not set: nobody will be an admin")
	}
	return New(cfg, st, repo, log).Handler(), nil
}

// Vercel wraps Lazy for the serverless entry point.
func Vercel(cfg Config) http.Handler { return rewrite(NewLazy(cfg)) }

// rewrite undoes vercel.json's rewrite of /api/<path> to /api/index?__route=<path>,
// so the router sees exactly the path the browser requested.
func rewrite(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if route := q.Get("__route"); route != "" && (r.URL.Path == "/api" || r.URL.Path == "/api/index") {
			r.URL.Path = "/api/" + strings.TrimPrefix(route, "/")
			r.URL.RawPath = ""
			q.Del("__route")
			r.URL.RawQuery = q.Encode()
		}
		next.ServeHTTP(w, r)
	})
}
