package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/anand1296/frontend-loop/backend/markdown"
	"github.com/anand1296/frontend-loop/backend/store"
)

// Site holds deployment-wide settings the owner controls.
type Site struct {
	Name    string `json:"name"`
	Tagline string `json:"tagline"`
	// Registration: "invite" (only invite links create accounts) or "open" (anyone with GitHub).
	Registration string `json:"registration"`
	// ContentAccess: "public" (anyone can read; sign in to sync) or "members" (sign in to read).
	ContentAccess string `json:"contentAccess"`
}

// defaultSite is private by default: visitors land on the sign-in screen and
// only invited people get in. The owner can open it up in Features & settings.
func defaultSite() Site {
	return Site{Name: "Frontend Loop", Tagline: "", Registration: "invite", ContentAccess: "members"}
}

func (s Site) validate() string {
	switch {
	case strings.TrimSpace(s.Name) == "" || utf8.RuneCountInString(s.Name) > 40:
		return "name must be 1-40 characters"
	case utf8.RuneCountInString(s.Tagline) > 200:
		return "tagline must be at most 200 characters"
	case s.Registration != "invite" && s.Registration != "open":
		return `registration must be "invite" or "open"`
	case s.ContentAccess != "public" && s.ContentAccess != "members":
		return `contentAccess must be "public" or "members"`
	}
	return ""
}

// Feature is a switch the admin console can flip without a deploy.
type Feature struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Default     bool   `json:"default"`
}

// Features lists every flag the frontend understands. Adding a flag is a code
// change (the UI must read it); flipping one is a setting.
var Features = []Feature{
	{"review", "Spaced review", "The Review page and due-for-review counts (2, 5, 12, 30, 75 day ladder).", true},
	{"search", "Search", "The search dialog (/ or Ctrl+K) across questions, tags and answers.", true},
	{"notes", "Personal notes", "A private notes box under every answer.", true},
	{"filters", "Round filters", "Status and level filters on each round page.", true},
	{"progressTransfer", "Export and import", "Progress export/import in Settings.", true},
	{"levelOverview", "Level breakdown", "The Senior / Lead / Principal progress cards on the overview.", true},
}

func featureFlags(stored map[string]bool) map[string]bool {
	out := map[string]bool{}
	for _, f := range Features {
		v, ok := stored[f.Key]
		if !ok {
			v = f.Default
		}
		out[f.Key] = v
	}
	return out
}

// Announcement is a banner shown to everyone.
type Announcement struct {
	Message string `json:"message"`
	Tone    string `json:"tone"`
	// Link is optional; it must be http(s) or an in-app #route.
	LinkURL   string `json:"linkUrl"`
	LinkLabel string `json:"linkLabel"`
	UpdatedAt int64  `json:"updatedAt"`
}

const announcementLimit = 280

func (a Announcement) validate() string {
	switch {
	case utf8.RuneCountInString(a.Message) > announcementLimit:
		return "message must be at most 280 characters"
	case a.Tone != "info" && a.Tone != "success" && a.Tone != "warning":
		return `tone must be "info", "success" or "warning"`
	case a.LinkURL != "" && !markdown.SafeHref(a.LinkURL):
		return "link must start with https://, http:// or #"
	case utf8.RuneCountInString(a.LinkLabel) > 40:
		return "link label must be at most 40 characters"
	}
	return ""
}

// settingsSnapshot is read on every bootstrap; it is tiny and cached for a few
// seconds per instance so a busy page doesn't hit the database for it each time.
type settingsSnapshot struct {
	site         Site
	features     map[string]bool
	announcement *Announcement
	at           time.Time
}

const settingsTTL = 5 * time.Second

func (s *Server) invalidateSettings() {
	s.settingsMu.Lock()
	s.settingsSnap = nil
	s.settingsMu.Unlock()
}

func (s *Server) settings(ctx context.Context) settingsSnapshot {
	s.settingsMu.Lock()
	cached := s.settingsSnap
	s.settingsMu.Unlock()
	if cached != nil && s.now().Sub(cached.at) < settingsTTL {
		return *cached
	}
	snap := settingsSnapshot{site: defaultSite(), features: featureFlags(nil), at: s.now()}
	raw, err := s.store.GetSettings(ctx, "site", "features", "announcement")
	if err != nil {
		s.log.WarnContext(ctx, "settings unavailable, using defaults", "err", err)
		return snap
	}
	if v, ok := raw["site"]; ok {
		site := defaultSite()
		if json.Unmarshal(v, &site) == nil && site.validate() == "" {
			snap.site = site
		}
	}
	if v, ok := raw["features"]; ok {
		var stored map[string]bool
		if json.Unmarshal(v, &stored) == nil {
			snap.features = featureFlags(stored)
		}
	}
	if v, ok := raw["announcement"]; ok {
		var a Announcement
		if json.Unmarshal(v, &a) == nil && strings.TrimSpace(a.Message) != "" {
			snap.announcement = &a
		}
	}
	s.settingsMu.Lock()
	s.settingsSnap = &snap
	s.settingsMu.Unlock()
	return snap
}

func (s *Server) siteSettings(ctx context.Context) Site { return s.settings(ctx).site }

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request, _ store.User) {
	snap := s.settings(r.Context())
	announcement := Announcement{Tone: "info"}
	if snap.announcement != nil {
		announcement = *snap.announcement
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"site":         snap.site,
		"features":     snap.features,
		"featureList":  Features,
		"announcement": announcement,
	})
}

func (s *Server) putSetting(w http.ResponseWriter, r *http.Request, user store.User) {
	key := r.PathValue("key")
	var value any
	switch key {
	case "site":
		if user.Role != store.RoleOwner {
			writeError(w, http.StatusForbidden, "owner_only", "Only the owner can change site access settings.")
			return
		}
		var site Site
		if !decode(w, r, &site) {
			return
		}
		site.Name = strings.TrimSpace(site.Name)
		site.Tagline = strings.TrimSpace(site.Tagline)
		if msg := site.validate(); msg != "" {
			writeError(w, http.StatusUnprocessableEntity, "invalid", msg)
			return
		}
		value = site
	case "features":
		var flags map[string]bool
		if !decode(w, r, &flags) {
			return
		}
		known := featureFlags(nil)
		for k := range flags {
			if _, ok := known[k]; !ok {
				writeError(w, http.StatusUnprocessableEntity, "invalid", "unknown feature "+k)
				return
			}
		}
		value = featureFlags(flags)
	case "announcement":
		var a Announcement
		if !decode(w, r, &a) {
			return
		}
		a.Message = strings.TrimSpace(a.Message)
		a.LinkURL = strings.TrimSpace(a.LinkURL)
		a.LinkLabel = strings.TrimSpace(a.LinkLabel)
		if a.Tone == "" {
			a.Tone = "info"
		}
		if msg := a.validate(); msg != "" {
			writeError(w, http.StatusUnprocessableEntity, "invalid", msg)
			return
		}
		a.UpdatedAt = s.now().UnixMilli()
		value = a
	default:
		writeError(w, http.StatusNotFound, "not_found", "Unknown setting "+key)
		return
	}
	if err := s.store.PutSetting(r.Context(), user.ID, key, value); err != nil {
		s.storeError(w, r, err)
		return
	}
	s.invalidateSettings()
	writeJSON(w, http.StatusOK, value)
}

/* ---------------------------------------------------------------- rate limiting */

// limiter is a fixed-window counter per key. On serverless each instance has
// its own memory, so this is best-effort abuse protection, not a quota.
type limiter struct {
	mu      sync.Mutex
	windows map[string]*window
}

type window struct {
	start time.Time
	count int
}

func newLimiter() *limiter { return &limiter{windows: map[string]*window{}} }

func (l *limiter) allow(key string, max int, per time.Duration) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.windows) > 10_000 {
		for k, w := range l.windows {
			if now.Sub(w.start) > per {
				delete(l.windows, k)
			}
		}
	}
	w, ok := l.windows[key]
	if !ok || now.Sub(w.start) > per {
		l.windows[key] = &window{start: now, count: 1}
		return true
	}
	w.count++
	return w.count <= max
}

// clientIP trusts X-Forwarded-For only behind a known proxy (Vercel, or TRUST_PROXY=1).
func (s *Server) clientIP(r *http.Request) string {
	if s.cfg.TrustProxy {
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			return strings.TrimSpace(strings.Split(fwd, ",")[0])
		}
	}
	return remoteHost(r)
}
