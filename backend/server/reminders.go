package server

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"html/template"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/anand1296/frontend-loop/backend/auth"
	"github.com/anand1296/frontend-loop/backend/mail"
	"github.com/anand1296/frontend-loop/backend/reminders"
	"github.com/anand1296/frontend-loop/backend/store"
)

// Email reminders: each person opts in (default off) and picks a frequency.
// A daily scheduler (Vercel Cron → GET /api/cron/reminders) sends whatever is due.

const cronBatch = 50 // per run; anything left over goes out on the next run

type reminderView struct {
	store.ReminderPrefs
	Email           string   `json:"email"`
	EmailConfigured bool     `json:"emailConfigured"`
	Available       bool     `json:"available"` // the admin's feature flag
	Frequencies     []string `json:"frequencies"`
}

func (s *Server) reminderView(r *http.Request, user store.User) (reminderView, error) {
	prefs, err := s.store.GetReminderPrefs(r.Context(), user.ID)
	if err != nil {
		return reminderView{}, err
	}
	return reminderView{
		ReminderPrefs:   prefs,
		Email:           user.Email,
		EmailConfigured: s.mailer.Configured(),
		Available:       s.settings(r.Context()).features["emailReminders"],
		Frequencies:     reminders.Frequencies,
	}, nil
}

func (s *Server) getReminders(w http.ResponseWriter, r *http.Request, user store.User) {
	view, err := s.reminderView(r, user)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (s *Server) putReminders(w http.ResponseWriter, r *http.Request, user store.User) {
	var body struct {
		Enabled   bool   `json:"enabled"`
		Frequency string `json:"frequency"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Frequency == "" {
		body.Frequency = "weekly"
	}
	switch {
	case !reminders.ValidFrequency(body.Frequency):
		writeError(w, http.StatusUnprocessableEntity, "invalid", "frequency must be daily, every3days or weekly")
		return
	case body.Enabled && !s.settings(r.Context()).features["emailReminders"]:
		writeError(w, http.StatusForbidden, "disabled", "Email reminders are switched off for this site.")
		return
	case body.Enabled && user.Email == "":
		writeError(w, http.StatusUnprocessableEntity, "no_email", "We don't have a verified email address for you yet. Sign out and sign in again so GitHub can share it.")
		return
	}
	token, err := auth.NewToken()
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	if _, err := s.store.SetReminderPrefs(r.Context(), user.ID, body.Enabled, body.Frequency, token); err != nil {
		s.storeError(w, r, err)
		return
	}
	s.getReminders(w, r, user)
}

// appURL is where links in emails point. APP_URL is preferred: the scheduler's
// request may arrive on an internal deployment host.
func (s *Server) appURL(r *http.Request) string {
	if s.cfg.PublicURL != "" {
		return s.cfg.PublicURL
	}
	return s.origin(r)
}

// composeReminder gathers progress and published content for one person.
func (s *Server) composeReminder(ctx context.Context, base string, user store.User, frequency, token string) (mail.Message, error) {
	idx, err := s.store.Index(ctx, false)
	if err != nil {
		return mail.Message{}, err
	}
	rounds := make([]reminders.Round, 0, len(idx.Sections))
	for _, sec := range idx.Sections {
		round := reminders.Round{ID: sec.ID, Title: sec.Title}
		for _, q := range sec.Questions {
			round.Questions = append(round.Questions, reminders.Question{ID: q.ID, Title: q.Title})
		}
		rounds = append(rounds, round)
	}
	doc, err := s.store.GetProgress(ctx, user.ID)
	if err != nil {
		return mail.Message{}, err
	}
	name := user.Name
	if name == "" || name == user.Login {
		name = user.Login
	}
	return reminders.Compose(reminders.Input{
		UserID:         user.ID,
		Name:           name,
		Email:          user.Email,
		SiteName:       s.settings(ctx).site.Name,
		AppURL:         base,
		UnsubscribeURL: base + "/api/reminders/unsubscribe?token=" + url.QueryEscape(token),
		Frequency:      frequency,
		Doc:            doc,
		Rounds:         rounds,
		Now:            s.now(),
	})
}

// testReminder sends one reminder now, so people can see what they signed up for.
func (s *Server) testReminder(w http.ResponseWriter, r *http.Request, user store.User) {
	switch {
	case !s.mailer.Configured():
		writeError(w, http.StatusServiceUnavailable, "email_unconfigured", "Email isn't set up on this server yet (the admin needs to add SMTP settings).")
		return
	case user.Email == "":
		writeError(w, http.StatusUnprocessableEntity, "no_email", "We don't have a verified email address for you yet. Sign out and sign in again so GitHub can share it.")
		return
	case !s.limiter.allow(fmt.Sprintf("test-reminder:%d", user.ID), 3, time.Hour):
		writeError(w, http.StatusTooManyRequests, "rate_limited", "You can send 3 test emails an hour. Try again later.")
		return
	}
	prefs, err := s.store.GetReminderPrefs(r.Context(), user.ID)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	newToken, err := auth.NewToken()
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	// Make sure a prefs row (and so an unsubscribe token) exists without changing the settings.
	if _, err := s.store.SetReminderPrefs(r.Context(), user.ID, prefs.Enabled, prefs.Frequency, newToken); err != nil {
		s.storeError(w, r, err)
		return
	}
	token, err := s.store.ReminderToken(r.Context(), user.ID)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	msg, err := s.composeReminder(r.Context(), s.appURL(r), user, prefs.Frequency, token)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	if err := s.mailer.Send(ctx, msg); err != nil {
		s.log.ErrorContext(r.Context(), "test reminder failed", "user", user.Login, "err", err)
		writeError(w, http.StatusBadGateway, "send_failed", "Couldn't send the email. The admin can find the reason in the server logs.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "to": user.Email})
}

// cronReminders is called once a day by the scheduler. It claims due reminders
// (so overlapping runs never double-send), sends them, and releases any that fail.
func (s *Server) cronReminders(w http.ResponseWriter, r *http.Request) {
	if s.cfg.CronSecret == "" {
		writeError(w, http.StatusServiceUnavailable, "cron_unconfigured", "Set CRON_SECRET to enable scheduled reminders.")
		return
	}
	given := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if subtle.ConstantTimeCompare([]byte(given), []byte(s.cfg.CronSecret)) != 1 {
		writeError(w, http.StatusUnauthorized, "unauthorized", "Bad scheduler credentials.")
		return
	}
	if !s.settings(r.Context()).features["emailReminders"] {
		writeJSON(w, http.StatusOK, map[string]any{"skipped": "feature switched off"})
		return
	}
	if !s.mailer.Configured() {
		writeJSON(w, http.StatusOK, map[string]any{"skipped": "email not configured"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	claimed, err := s.store.ClaimDueReminders(ctx, s.now(), cronBatch)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	base := s.appURL(r)
	sent, failed := 0, 0
	for _, c := range claimed {
		err := s.sendClaimed(ctx, base, c)
		if err == nil {
			sent++
			_ = s.store.ReminderSent(context.WithoutCancel(ctx), c.UserID, s.now())
			continue
		}
		failed++
		s.log.WarnContext(ctx, "reminder failed", "user", c.UserID, "err", err)
		_ = s.store.ReminderFailed(context.WithoutCancel(ctx), c.UserID, c.Previous, err.Error())
	}
	s.log.InfoContext(ctx, "reminders run", "claimed", len(claimed), "sent", sent, "failed", failed)
	writeJSON(w, http.StatusOK, map[string]int{"claimed": len(claimed), "sent": sent, "failed": failed})
}

func (s *Server) sendClaimed(ctx context.Context, base string, c store.ClaimedReminder) error {
	if ctx.Err() != nil {
		return errors.New("out of time in this run; will retry")
	}
	user, err := s.store.GetUser(ctx, c.UserID)
	if err != nil {
		return err
	}
	msg, err := s.composeReminder(ctx, base, user, c.Frequency, c.Token)
	if err != nil {
		return err
	}
	sendCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return s.mailer.Send(sendCtx, msg)
}

/* ---------------------------------------------------------------- unsubscribe */

var unsubscribeTemplate = template.Must(template.New("unsubscribe").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Email reminders · {{.Site}}</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6f9;color:#161b2e;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px}
main{max-width:420px;background:#fff;border:1px solid #dde1ea;border-radius:14px;padding:28px}
h1{font-size:22px;margin:0 0 10px}p{line-height:1.55;color:#464e66}
button,a.btn{display:inline-block;font:inherit;font-weight:700;border:0;border-radius:8px;padding:11px 18px;background:#3346d3;color:#fff;text-decoration:none;cursor:pointer}
</style></head><body><main>
<h1>{{.Title}}</h1><p>{{.Body}}</p>
{{if .Confirm}}<form method="post" action="/api/reminders/unsubscribe?token={{.Token}}"><button type="submit">Unsubscribe</button></form>
{{else}}<a class="btn" href="{{.AppURL}}">Open {{.Site}}</a>{{end}}
</main></body></html>`))

func (s *Server) renderUnsubscribe(w http.ResponseWriter, r *http.Request, status int, title, body string, confirm bool) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_ = unsubscribeTemplate.Execute(w, map[string]any{
		"Site": s.siteSettings(r.Context()).Name, "AppURL": s.appURL(r) + "/",
		"Title": title, "Body": body, "Confirm": confirm, "Token": r.URL.Query().Get("token"),
	})
}

// unsubscribePage asks for confirmation: GET must not change anything, because
// mail scanners open links in emails automatically.
func (s *Server) unsubscribePage(w http.ResponseWriter, r *http.Request) {
	enabled, err := s.store.ReminderByToken(r.Context(), r.URL.Query().Get("token"))
	switch {
	case errors.Is(err, store.ErrNotFound):
		s.renderUnsubscribe(w, r, http.StatusNotFound, "Link not recognized", "This unsubscribe link isn't valid. You can switch reminders off in Settings inside the app.", false)
	case err != nil:
		s.storeError(w, r, err)
	case !enabled:
		s.renderUnsubscribe(w, r, http.StatusOK, "You're unsubscribed", "You won't get reminder emails. You can switch them back on in Settings anytime.", false)
	default:
		s.renderUnsubscribe(w, r, http.StatusOK, "Stop reminder emails?", "You'll stop getting progress reminders. Your progress stays exactly as it is.", true)
	}
}

// unsubscribe handles the confirmation form and RFC 8058 one-click POSTs from mail providers.
func (s *Server) unsubscribe(w http.ResponseWriter, r *http.Request) {
	err := s.store.Unsubscribe(r.Context(), r.URL.Query().Get("token"))
	switch {
	case errors.Is(err, store.ErrNotFound):
		s.renderUnsubscribe(w, r, http.StatusNotFound, "Link not recognized", "This unsubscribe link isn't valid. You can switch reminders off in Settings inside the app.", false)
	case err != nil:
		s.storeError(w, r, err)
	default:
		s.renderUnsubscribe(w, r, http.StatusOK, "You're unsubscribed", "You won't get reminder emails. You can switch them back on in Settings anytime.", false)
	}
}
