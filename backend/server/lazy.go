package server

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/anand1296/frontend-loop/backend/catalog"
	"github.com/anand1296/frontend-loop/backend/store"
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

func (l *Lazy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if l.cfg.DatabaseURL == "" {
		// Deployed without a database: the frontend sees 503 on /api/bootstrap
		// and falls back to its built-in, local-only mode.
		writeError(w, http.StatusServiceUnavailable, "not_configured", "The backend has no DATABASE_URL configured.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	h, err := l.get(ctx)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "starting", "The backend is starting or can't reach its database. Try again shortly.")
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
