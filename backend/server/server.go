// Package server is the HTTP API. It uses only the standard library router
// (Go 1.22+ method and wildcard patterns) and a handful of small middlewares,
// so every request's path through the code is easy to follow:
//
//	recover → security headers → access log → CSRF guard → session → handler
//
// The same http.Handler runs as a long-lived server (cmd/server) and as a
// Vercel serverless function (api/index.go).
package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/anand1296/frontend-loop/backend/auth"
	"github.com/anand1296/frontend-loop/backend/catalog"
	"github.com/anand1296/frontend-loop/backend/store"
	"github.com/anand1296/frontend-loop/content"
)

// Version is reported by /api/health. Overridden at build time with -ldflags.
var Version = "dev"

// Server holds the API's dependencies.
type Server struct {
	cfg      Config
	store    *store.Store
	compiler *catalog.Compiler
	github   *auth.GitHub
	repo     []catalog.Section
	limiter  *limiter
	log      *slog.Logger
	now      func() time.Time

	settingsMu   sync.Mutex
	settingsSnap *settingsSnapshot
}

// New builds a Server. repo is the repository content used for seeding and "Sync from repository".
func New(cfg Config, st *store.Store, repo []catalog.Section, log *slog.Logger) *Server {
	if log == nil {
		log = slog.Default()
	}
	return &Server{
		cfg:      cfg,
		store:    st,
		compiler: catalog.NewCompiler(),
		github:   auth.NewGitHub(cfg.GitHubClientID, cfg.GitHubClientSecret),
		repo:     repo,
		limiter:  newLimiter(),
		log:      log,
		now:      time.Now,
	}
}

// SetClock replaces the clock (tests).
func (s *Server) SetClock(now func() time.Time) { s.now = now }

// SetGitHub replaces the OAuth client (tests point it at a fake GitHub).
func (s *Server) SetGitHub(g *auth.GitHub) { s.github = g }

// Prepare migrates the schema and seeds content on first run.
func Prepare(ctx context.Context, st *store.Store, compiler *catalog.Compiler) ([]catalog.Section, error) {
	if err := st.Migrate(ctx); err != nil {
		return nil, err
	}
	repo, err := catalog.ParseFS(content.Files)
	if err != nil {
		return nil, fmt.Errorf("repository content: %w", err)
	}
	if _, err := st.SeedIfEmpty(ctx, repo, compiler.Check); err != nil {
		return nil, fmt.Errorf("seed: %w", err)
	}
	return repo, nil
}

// Handler returns the API with all middleware applied.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	s.routes(mux)
	var h http.Handler = mux
	h = s.withSession(h)
	h = s.withCSRF(h)
	h = s.withAccessLog(h)
	h = withSecurityHeaders(h)
	h = s.withRecover(h)
	return h
}

func (s *Server) routes(mux *http.ServeMux) {
	// Public
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("GET /api/bootstrap", s.bootstrap)
	mux.HandleFunc("GET /api/content/sections/{id}", s.sectionAnswers)
	mux.HandleFunc("GET /api/invites/{token}", s.inviteInfo)

	// Auth
	mux.HandleFunc("GET /api/auth/github/start", s.githubStart)
	mux.HandleFunc("GET /api/auth/github/callback", s.githubCallback)
	mux.HandleFunc("POST /api/auth/dev-login", s.devLogin)
	mux.HandleFunc("POST /api/auth/logout", s.logout)

	// Signed-in learner
	mux.HandleFunc("GET /api/me/progress", s.signedIn(s.getProgress))
	mux.HandleFunc("PUT /api/me/progress", s.signedIn(s.putProgress))
	mux.HandleFunc("DELETE /api/me", s.signedIn(s.deleteMe))

	// Admin console
	admin := func(pattern string, h handlerWithUser) { mux.HandleFunc(pattern, s.adminOnly(h)) }
	admin("GET /api/admin/users", s.listUsers)
	admin("PATCH /api/admin/users/{id}", s.updateUser)
	admin("DELETE /api/admin/users/{id}", s.deleteUser)

	admin("GET /api/admin/invites", s.listInvites)
	admin("POST /api/admin/invites", s.createInvite)
	admin("DELETE /api/admin/invites/{id}", s.revokeInvite)

	admin("GET /api/admin/content", s.adminContent)
	admin("POST /api/admin/sections", s.createSection)
	admin("PUT /api/admin/sections/order", s.reorderSections)
	admin("PATCH /api/admin/sections/{id}", s.updateSection)
	admin("DELETE /api/admin/sections/{id}", s.deleteSection)
	admin("PUT /api/admin/sections/{id}/order", s.reorderQuestions)
	admin("GET /api/admin/sections/{id}/export", s.exportSection)
	admin("GET /api/admin/export", s.exportAll)

	admin("POST /api/admin/questions", s.createQuestion)
	admin("GET /api/admin/questions/{id}", s.getQuestion)
	admin("PUT /api/admin/questions/{id}", s.updateQuestion)
	admin("DELETE /api/admin/questions/{id}", s.deleteQuestion)
	admin("GET /api/admin/questions/{id}/revisions", s.listRevisions)
	admin("GET /api/admin/questions/{id}/revisions/{rev}", s.getRevision)
	admin("POST /api/admin/questions/{id}/revisions/{rev}/restore", s.restoreRevision)
	admin("GET /api/admin/trash", s.trash)
	admin("POST /api/admin/preview", s.preview)
	admin("GET /api/admin/sync", s.planSync)
	admin("POST /api/admin/sync", s.applySync)

	admin("GET /api/admin/settings", s.getSettings)
	admin("PUT /api/admin/settings/{key}", s.putSetting)
	admin("GET /api/admin/audit", s.listAudit)

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "not_found", "No such API endpoint.")
	})
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	db := s.store.Ping(ctx) == nil
	status := http.StatusOK
	if !db {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, map[string]any{"ok": db, "database": db, "version": Version, "github": s.github.Configured()})
}

/* ---------------------------------------------------------------- responses */

type apiError struct {
	Code     string               `json:"code"`
	Message  string               `json:"message"`
	Problems []catalog.FieldError `json:"problems,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]apiError{"error": {Code: code, Message: message}})
}

func writeProblems(w http.ResponseWriter, problems catalog.Problems) {
	writeJSON(w, http.StatusUnprocessableEntity, map[string]apiError{"error": {
		Code: "invalid", Message: "Please fix the highlighted fields.", Problems: problems,
	}})
}

// storeError maps data-layer errors onto HTTP. Unknown errors are logged, never echoed.
func (s *Server) storeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, store.ErrNoSection):
		writeProblems(w, catalog.Problems{{Field: "sectionId", Message: "that round doesn't exist"}})
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "That item doesn't exist (it may have been deleted).")
	case errors.Is(err, store.ErrConflict):
		writeError(w, http.StatusConflict, "conflict", "Someone saved this question after you opened it. Reload to see their version, then re-apply your change.")
	case errors.Is(err, store.ErrIDTaken):
		writeJSON(w, http.StatusConflict, map[string]apiError{"error": {Code: "id_taken", Message: err.Error(),
			Problems: []catalog.FieldError{{Field: "id", Message: "is already used by another round or question"}}}})
	case errors.Is(err, store.ErrInvalidList):
		writeError(w, http.StatusBadRequest, "invalid_order", err.Error())
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		writeError(w, http.StatusServiceUnavailable, "timeout", "The database took too long to answer. Try again.")
	default:
		var problems catalog.Problems
		if errors.As(err, &problems) {
			writeProblems(w, problems)
			return
		}
		s.log.ErrorContext(r.Context(), "store error", "path", r.URL.Path, "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "Something went wrong on our side.")
	}
}

const maxBody = 1 << 20 // 1 MiB: the largest legitimate body is a long answer or a progress document

func decode(w http.ResponseWriter, r *http.Request, into any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(into); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, "too_large", "Request body is too large.")
		} else {
			writeError(w, http.StatusBadRequest, "bad_json", "Request body is not valid JSON for this endpoint: "+err.Error())
		}
		return false
	}
	return true
}

/* ---------------------------------------------------------------- middleware */

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (s *Server) withAccessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		s.log.InfoContext(r.Context(), "request", "method", r.Method, "path", r.URL.Path, "status", rec.status,
			"ms", time.Since(start).Milliseconds())
	})
}

func (s *Server) withRecover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				s.log.ErrorContext(r.Context(), "panic", "value", fmt.Sprint(v), "stack", string(debug.Stack()))
				writeError(w, http.StatusInternalServerError, "internal", "Something went wrong on our side.")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Cache-Control", "no-store") // handlers that are cacheable override this
		h.Set("Cross-Origin-Resource-Policy", "same-origin")
		next.ServeHTTP(w, r)
	})
}

// CSRFHeader must accompany every state-changing request. Browsers won't let
// another site set a custom header without a CORS preflight, which this API
// never approves; together with SameSite=Lax cookies and the Origin check
// this closes cross-site request forgery.
const CSRFHeader = "X-Requested-With"

// CSRFValue is the expected header value.
const CSRFValue = "frontend-loop"

func (s *Server) withCSRF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		}
		if r.Header.Get(CSRFHeader) != CSRFValue {
			writeError(w, http.StatusForbidden, "csrf", "Missing "+CSRFHeader+" header.")
			return
		}
		if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" {
			writeError(w, http.StatusForbidden, "csrf", "Cross-site requests are not allowed.")
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && origin != s.origin(r) {
			writeError(w, http.StatusForbidden, "csrf", "Request origin does not match this site.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// origin is this deployment's scheme://host.
func (s *Server) origin(r *http.Request) string {
	if s.cfg.PublicURL != "" {
		return s.cfg.PublicURL
	}
	scheme, host := "http", r.Host
	if r.TLS != nil {
		scheme = "https"
	}
	if s.cfg.TrustProxy {
		if strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
			scheme = "https"
		}
		if fwd := r.Header.Get("X-Forwarded-Host"); fwd != "" {
			host = fwd
		}
	}
	return scheme + "://" + host
}

func remoteHost(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
