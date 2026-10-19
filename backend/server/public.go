package server

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/anand1296/whetstone/backend/auth"
	"github.com/anand1296/whetstone/backend/progress"
	"github.com/anand1296/whetstone/backend/store"
)

// Reader-facing shapes match src/content/types.ts (SectionMeta, QuestionMeta).
type readerQuestion struct {
	ID         string   `json:"id"`
	SectionID  string   `json:"sectionId"`
	Title      string   `json:"title"`
	Level      string   `json:"level"`
	Tags       []string `json:"tags"`
	Minutes    int      `json:"minutes"`
	Summary    string   `json:"summary"`
	SearchText string   `json:"searchText"`
	Published  bool     `json:"published"`
	// Contributor is the GitHub login credited for a community question.
	Contributor string `json:"contributor,omitempty"`
}

type readerSection struct {
	ID          string           `json:"id"`
	Title       string           `json:"title"`
	Description string           `json:"description"`
	Published   bool             `json:"published"`
	Questions   []readerQuestion `json:"questions"`
}

type readerContent struct {
	Version  int64           `json:"version"`
	Sections []readerSection `json:"sections"`
}

func toReader(idx store.Index) readerContent {
	out := readerContent{Version: idx.Version, Sections: make([]readerSection, 0, len(idx.Sections))}
	for _, sec := range idx.Sections {
		rs := readerSection{ID: sec.ID, Title: sec.Title, Description: sec.Description, Published: sec.Published, Questions: make([]readerQuestion, 0, len(sec.Questions))}
		for _, q := range sec.Questions {
			rs.Questions = append(rs.Questions, readerQuestion{q.ID, q.SectionID, q.Title, q.Level, q.Tags, q.Minutes, q.Summary, q.SearchText, q.Published, q.Contributor})
		}
		out.Sections = append(out.Sections, rs)
	}
	return out
}

type publicUser struct {
	ID        int64  `json:"id"`
	Login     string `json:"login"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatarUrl"`
	Role      string `json:"role"`
}

// canRead applies the "members only" setting.
func (s *Server) canRead(r *http.Request) bool {
	if _, ok := currentUser(r); ok {
		return true
	}
	return s.siteSettings(r.Context()).ContentAccess == "public"
}

// bootstrap is the one request the app makes before its first render: who am
// I, what is switched on, and the content outline. Answers load per round.
func (s *Server) bootstrap(w http.ResponseWriter, r *http.Request) {
	snap := s.settings(r.Context())
	user, signedIn := currentUser(r)
	body := map[string]any{
		"mode":         "server",
		"site":         snap.site,
		"features":     snap.features,
		"announcement": snap.announcement,
		"auth":         map[string]bool{"github": s.github.Configured(), "dev": s.cfg.DevLogin},
		"email":        s.mailer.Configured(),
		"user":         nil,
		"content":      nil,
		"locked":       false,
	}
	if signedIn {
		body["user"] = publicUser{user.ID, user.Login, user.Name, user.AvatarURL, user.Role}
		if user.IsAdmin() {
			if n, err := s.store.CountPendingSubmissions(r.Context(), 0); err == nil {
				body["pendingSubmissions"] = n
			}
		}
	}
	if !s.canRead(r) {
		body["locked"] = true
		writeJSON(w, http.StatusOK, body)
		return
	}
	idx, err := s.store.Index(r.Context(), signedIn && user.IsAdmin())
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	body["content"] = toReader(idx)
	writeJSON(w, http.StatusOK, body)
}

// sectionAnswers serves one round's answer HTML, revalidated by content version (ETag).
func (s *Server) sectionAnswers(w http.ResponseWriter, r *http.Request) {
	if !s.canRead(r) {
		writeError(w, http.StatusUnauthorized, "signed_out", "Sign in to read this content.")
		return
	}
	user, signedIn := currentUser(r)
	drafts := signedIn && user.IsAdmin()
	version, err := s.store.ContentVersion(r.Context())
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	variant := "p"
	if drafts {
		variant = "d"
	}
	etag := fmt.Sprintf(`"c%d-%s-%s"`, version, variant, r.PathValue("id"))
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Set("ETag", etag)
	w.Header().Set("Vary", "Cookie")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	answers, err := s.store.SectionAnswers(r.Context(), r.PathValue("id"), drafts)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"version": version, "answers": answers})
}

// inviteInfo lets the invite landing page say what the link is for (never who else was invited).
func (s *Server) inviteInfo(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow("invite:"+s.clientIP(r), 30, time.Minute) {
		writeError(w, http.StatusTooManyRequests, "rate_limited", "Too many requests. Wait a minute.")
		return
	}
	inv, err := s.store.InviteByToken(r.Context(), auth.Hash(r.PathValue("token")))
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "invalid"})
		return
	}
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":    inv.Status(s.now()),
		"role":      inv.Role,
		"invitedBy": inv.CreatedBy,
		"expiresAt": inv.ExpiresAt,
		"siteName":  s.siteSettings(r.Context()).Name,
	})
}

/* ---------------------------------------------------------------- progress */

func (s *Server) getProgress(w http.ResponseWriter, r *http.Request, user store.User) {
	doc, err := s.store.GetProgress(r.Context(), user.ID)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, doc)
}

// putProgress merges the client's replica into the server copy and returns the
// merged document, so one round trip both saves and pulls other devices' changes.
func (s *Server) putProgress(w http.ResponseWriter, r *http.Request, user store.User) {
	if !s.limiter.allow(fmt.Sprintf("progress:%d", user.ID), 120, time.Minute) {
		writeError(w, http.StatusTooManyRequests, "rate_limited", "Saving too often. Slow down.")
		return
	}
	var raw map[string]any
	if !decode(w, r, &raw) {
		return
	}
	incoming, err := progress.FromMap(raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid", err.Error())
		return
	}
	merged, err := s.store.MergeProgress(r.Context(), user.ID, incoming)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, merged)
}

// deleteMe removes the caller's account and progress (right to erasure). The owner can't delete themselves.
func (s *Server) deleteMe(w http.ResponseWriter, r *http.Request, user store.User) {
	if user.Role == store.RoleOwner {
		writeError(w, http.StatusForbidden, "owner", "The owner account can't be deleted from the app.")
		return
	}
	if err := s.store.DeleteUser(r.Context(), user.ID, user.ID); err != nil {
		s.storeError(w, r, err)
		return
	}
	s.clearCookie(w, r, s.sessionCookieName(r))
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
