// Command server runs Frontend Loop as one process: the API under /api and
// the built frontend (dist/) for everything else. Use it locally, in Docker,
// or on any host that runs a binary (Fly.io, Render, a VPS).
//
//	go run ./cmd/server                 # API on :8080, reads .env if present
//	go run ./cmd/server -static dist    # also serve the production build
package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/anand1296/frontend-loop/backend/server"
)

func main() {
	loadDotEnv(".env")
	addr := flag.String("addr", ":"+envOr("PORT", "8080"), "listen address")
	static := flag.String("static", os.Getenv("STATIC_DIR"), "directory with the built frontend (optional)")
	flag.Parse()

	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg := server.ConfigFromEnv()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var api http.Handler
	if cfg.DatabaseURL == "" {
		// Same behavior as an unconfigured Vercel deployment: the app shows its setup checklist.
		log.Warn("DATABASE_URL is not set: serving the setup checklist only (see .env.example)")
		api = server.NewLazy(cfg)
	} else {
		built, err := server.Build(ctx, cfg, log)
		if err != nil {
			log.Error("startup failed", "err", err)
			os.Exit(1)
		}
		api = built
	}

	mux := http.NewServeMux()
	mux.Handle("/api/", api)
	if *static != "" {
		mux.Handle("/", staticSite(*static))
	}

	srv := &http.Server{
		Addr:              *addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		log.Info("listening", "addr", *addr, "static", *static, "devLogin", cfg.DevLogin)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server failed", "err", err)
			os.Exit(1)
		}
	}()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdown) // finish in-flight requests
}

// ContentSecurityPolicy matches the one in vercel.json.
const ContentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
	"font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://avatars.githubusercontent.com; connect-src 'self'; " +
	"frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'"

// staticSite serves the Vite build: hashed assets cached forever, index.html never cached.
func staticSite(dir string) http.Handler {
	files := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", ContentSecurityPolicy)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("X-Frame-Options", "DENY")
		path := filepath.Clean(r.URL.Path)
		if strings.HasPrefix(path, "/assets/") {
			h.Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			h.Set("Cache-Control", "no-cache")
		}
		if _, err := os.Stat(filepath.Join(dir, path)); err != nil {
			r.URL.Path = "/" // hash routing: every unknown path is the app
		}
		files.ServeHTTP(w, r)
	})
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// loadDotEnv reads KEY=VALUE lines without overriding variables already set.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if _, set := os.LookupEnv(key); !set {
			_ = os.Setenv(key, value)
		}
	}
}
