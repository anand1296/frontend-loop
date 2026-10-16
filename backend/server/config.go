package server

import (
	"os"
	"strconv"
	"strings"
)

// Config is read from the environment (12-factor). Nothing secret is ever
// committed: locally it comes from .env (git-ignored), on Vercel from the
// project's Environment Variables.
type Config struct {
	// DatabaseURL is a Postgres connection string (Neon, Supabase, Docker...).
	DatabaseURL string
	// GitHubClientID / GitHubClientSecret come from a GitHub OAuth app.
	GitHubClientID     string
	GitHubClientSecret string
	// OwnerLogin is the GitHub login that is always the super admin.
	OwnerLogin string
	// PublicURL is the app's canonical origin, e.g. https://frontend-loop.vercel.app.
	// Used for the OAuth callback and the Origin check. Derived from the request when empty.
	PublicURL string
	// DevLogin enables password-less sign-in for local development and E2E tests.
	// Ignored on Vercel production deployments, whatever the variable says.
	DevLogin bool
	// MaxDBConns caps the pool (keep it small on serverless).
	MaxDBConns int
	// Production disables developer conveniences.
	Production bool
	// TrustProxy means X-Forwarded-For/-Proto/-Host come from a proxy we control (Vercel, a load balancer).
	TrustProxy bool
	// SMTP settings for email reminders (any provider: Gmail app password, Resend, Brevo…).
	SMTPHost     string
	SMTPPort     int
	SMTPUsername string
	SMTPPassword string
	EmailFrom    string // e.g. "Frontend Loop <you@gmail.com>"
	// CronSecret authenticates the scheduler (Vercel Cron sends "Authorization: Bearer <CRON_SECRET>").
	CronSecret string
}

// ConfigFromEnv reads Config from environment variables.
func ConfigFromEnv() Config {
	production := os.Getenv("VERCEL_ENV") == "production" || os.Getenv("APP_ENV") == "production"
	maxConns, _ := strconv.Atoi(os.Getenv("DB_MAX_CONNS"))
	if maxConns == 0 {
		maxConns = 10
		if os.Getenv("VERCEL") != "" {
			maxConns = 3
		}
	}
	smtpPort, _ := strconv.Atoi(os.Getenv("SMTP_PORT"))
	return Config{
		DatabaseURL:        firstEnv("DATABASE_URL", "POSTGRES_URL"),
		GitHubClientID:     os.Getenv("GITHUB_CLIENT_ID"),
		GitHubClientSecret: os.Getenv("GITHUB_CLIENT_SECRET"),
		OwnerLogin:         strings.ToLower(strings.TrimSpace(os.Getenv("OWNER_GITHUB_LOGIN"))),
		PublicURL:          strings.TrimRight(os.Getenv("APP_URL"), "/"),
		DevLogin:           os.Getenv("DEV_LOGIN") == "1" && !production,
		MaxDBConns:         maxConns,
		Production:         production,
		TrustProxy:         os.Getenv("VERCEL") != "" || os.Getenv("TRUST_PROXY") == "1",
		SMTPHost:           os.Getenv("SMTP_HOST"),
		SMTPPort:           smtpPort,
		SMTPUsername:       os.Getenv("SMTP_USERNAME"),
		SMTPPassword:       os.Getenv("SMTP_PASSWORD"),
		EmailFrom:          os.Getenv("EMAIL_FROM"),
		CronSecret:         os.Getenv("CRON_SECRET"),
	}
}

func firstEnv(keys ...string) string {
	for _, key := range keys {
		if v := os.Getenv(key); v != "" {
			return v
		}
	}
	return ""
}
