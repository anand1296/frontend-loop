package server

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/anand1296/frontend-loop/backend/auth"
	"github.com/anand1296/frontend-loop/backend/catalog"
	"github.com/anand1296/frontend-loop/backend/progress"
	"github.com/anand1296/frontend-loop/backend/store"
)

/* ---------------------------------------------------------------- people */

type person struct {
	store.User
	Summary           progress.Summary `json:"summary"`
	ProgressUpdatedAt *time.Time       `json:"progressUpdatedAt"`
}

// listUsers returns everyone with a coarse progress summary. Notes and
// per-question data never leave the learner's document.
func (s *Server) listUsers(w http.ResponseWriter, r *http.Request, _ store.User) {
	idx, err := s.store.Index(r.Context(), false)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	outline := make([]progress.SectionOutline, 0, len(idx.Sections))
	for _, sec := range idx.Sections {
		ids := make([]string, len(sec.Questions))
		for i, q := range sec.Questions {
			ids[i] = q.ID
		}
		outline = append(outline, progress.SectionOutline{ID: sec.ID, QuestionIDs: ids})
	}
	all, err := s.store.AllProgress(r.Context())
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	now := float64(s.now().UnixMilli())
	people := make([]person, 0, len(all))
	for _, lp := range all {
		people = append(people, person{User: lp.User, Summary: progress.Summarize(lp.Doc, outline, now), ProgressUpdatedAt: lp.UpdatedAt})
	}
	rounds := make([]map[string]any, 0, len(idx.Sections))
	for _, sec := range idx.Sections {
		rounds = append(rounds, map[string]any{"id": sec.ID, "title": sec.Title, "total": len(sec.Questions)})
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": people, "rounds": rounds})
}

func pathID(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	return id, err == nil && id > 0
}

// updateUser changes a role or disables an account. Rules:
// only the owner changes roles; nobody can change the owner; admins may
// disable learners, the owner may disable anyone else.
func (s *Server) updateUser(w http.ResponseWriter, r *http.Request, actor store.User) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid", "bad user id")
		return
	}
	var body struct {
		Role     *string `json:"role"`
		Disabled *bool   `json:"disabled"`
	}
	if !decode(w, r, &body) {
		return
	}
	target, err := s.store.GetUser(r.Context(), id)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	if msg := canManage(actor, target, body.Role); msg != "" {
		writeError(w, http.StatusForbidden, "forbidden", msg)
		return
	}
	user, err := s.store.UpdateUser(r.Context(), actor.ID, id, body.Role, body.Disabled)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func canManage(actor, target store.User, newRole *string) string {
	switch {
	case target.Role == store.RoleOwner:
		return "The owner's account is managed by configuration (OWNER_GITHUB_LOGIN)."
	case actor.ID == target.ID:
		return "You can't change your own account here."
	case newRole != nil && actor.Role != store.RoleOwner:
		return "Only the owner can change roles."
	case newRole != nil && *newRole != store.RoleAdmin && *newRole != store.RoleLearner:
		return `role must be "admin" or "learner"`
	case target.Role == store.RoleAdmin && actor.Role != store.RoleOwner:
		return "Only the owner can manage other admins."
	}
	return ""
}

func (s *Server) deleteUser(w http.ResponseWriter, r *http.Request, actor store.User) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid", "bad user id")
		return
	}
	target, err := s.store.GetUser(r.Context(), id)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	if msg := canManage(actor, target, nil); msg != "" {
		writeError(w, http.StatusForbidden, "forbidden", msg)
		return
	}
	if err := s.store.DeleteUser(r.Context(), actor.ID, id); err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

/* ---------------------------------------------------------------- invites */

type inviteView struct {
	store.Invite
	Status string `json:"status"`
}

func (s *Server) listInvites(w http.ResponseWriter, r *http.Request, _ store.User) {
	invites, err := s.store.ListInvites(r.Context())
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	out := make([]inviteView, 0, len(invites))
	for _, inv := range invites {
		out = append(out, inviteView{inv, inv.Status(s.now())})
	}
	writeJSON(w, http.StatusOK, out)
}

// createInvite returns the link exactly once; only its hash is stored.
func (s *Server) createInvite(w http.ResponseWriter, r *http.Request, actor store.User) {
	var body struct {
		Role      string `json:"role"`
		Note      string `json:"note"`
		MaxUses   int    `json:"maxUses"`
		ExpiresIn int    `json:"expiresInDays"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Role == "" {
		body.Role = store.RoleLearner
	}
	if body.MaxUses == 0 {
		body.MaxUses = 1
	}
	if body.ExpiresIn == 0 {
		body.ExpiresIn = 14
	}
	body.Note = strings.TrimSpace(body.Note)
	switch {
	case body.Role != store.RoleLearner && body.Role != store.RoleAdmin:
		writeError(w, http.StatusUnprocessableEntity, "invalid", `role must be "learner" or "admin"`)
		return
	case body.Role == store.RoleAdmin && actor.Role != store.RoleOwner:
		writeError(w, http.StatusForbidden, "owner_only", "Only the owner can invite admins.")
		return
	case body.MaxUses < 1 || body.MaxUses > 1000:
		writeError(w, http.StatusUnprocessableEntity, "invalid", "maxUses must be 1-1000")
		return
	case body.ExpiresIn < 1 || body.ExpiresIn > 90:
		writeError(w, http.StatusUnprocessableEntity, "invalid", "expiresInDays must be 1-90")
		return
	case len(body.Note) > 120:
		writeError(w, http.StatusUnprocessableEntity, "invalid", "note must be at most 120 characters")
		return
	}
	token, err := auth.NewToken()
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	inv, err := s.store.CreateInvite(r.Context(), actor.ID, auth.Hash(token), body.Role, body.Note, body.MaxUses, s.now().Add(time.Duration(body.ExpiresIn)*24*time.Hour))
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"invite": inviteView{inv, inv.Status(s.now())},
		"url":    s.origin(r) + "/?invite=" + token,
	})
}

func (s *Server) revokeInvite(w http.ResponseWriter, r *http.Request, actor store.User) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid", "bad invite id")
		return
	}
	if err := s.store.RevokeInvite(r.Context(), actor.ID, id, s.now()); err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

/* ---------------------------------------------------------------- content */

func (s *Server) adminContent(w http.ResponseWriter, r *http.Request, _ store.User) {
	idx, err := s.store.Index(r.Context(), true)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, idx)
}

type sectionInput struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Published   *bool  `json:"published"`
}

func (s *Server) createSection(w http.ResponseWriter, r *http.Request, actor store.User) {
	var in sectionInput
	if !decode(w, r, &in) {
		return
	}
	sec := catalog.Section{ID: in.ID, Title: in.Title, Description: in.Description, Published: in.Published == nil || *in.Published}
	sec.Normalize()
	if problems := sec.Validate(); len(problems) > 0 {
		writeProblems(w, problems)
		return
	}
	if err := s.store.CreateSection(r.Context(), actor.ID, sec); err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, sec)
}

func (s *Server) updateSection(w http.ResponseWriter, r *http.Request, actor store.User) {
	var in struct {
		Title       *string `json:"title"`
		Description *string `json:"description"`
		Published   *bool   `json:"published"`
	}
	if !decode(w, r, &in) {
		return
	}
	sec, err := s.store.GetSection(r.Context(), r.PathValue("id"))
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	if in.Title != nil {
		sec.Title = *in.Title
	}
	if in.Description != nil {
		sec.Description = *in.Description
	}
	if in.Published != nil {
		sec.Published = *in.Published
	}
	sec.Normalize()
	if problems := sec.Validate(); len(problems) > 0 {
		writeProblems(w, problems)
		return
	}
	if err := s.store.UpdateSection(r.Context(), actor.ID, sec); err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, sec)
}

func (s *Server) deleteSection(w http.ResponseWriter, r *http.Request, actor store.User) {
	if err := s.store.DeleteSection(r.Context(), actor.ID, r.PathValue("id")); err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) reorderSections(w http.ResponseWriter, r *http.Request, actor store.User) {
	var in struct {
		IDs []string `json:"ids"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := s.store.ReorderSections(r.Context(), actor.ID, in.IDs); err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) reorderQuestions(w http.ResponseWriter, r *http.Request, actor store.User) {
	var in struct {
		IDs []string `json:"ids"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := s.store.ReorderQuestions(r.Context(), actor.ID, r.PathValue("id"), in.IDs); err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type questionInput struct {
	ID        string   `json:"id"`
	SectionID string   `json:"sectionId"`
	Title     string   `json:"title"`
	Level     string   `json:"level"`
	Tags      []string `json:"tags"`
	Minutes   int      `json:"minutes"`
	Body      string   `json:"body"`
	Published bool     `json:"published"`
	Revision  int      `json:"revision"`
}

func (in questionInput) question() catalog.Question {
	q := catalog.Question{ID: in.ID, SectionID: in.SectionID, Title: in.Title, Level: in.Level, Tags: in.Tags, Minutes: in.Minutes, Body: in.Body, Published: in.Published}
	q.Normalize()
	return q
}

func (s *Server) createQuestion(w http.ResponseWriter, r *http.Request, actor store.User) {
	var in questionInput
	if !decode(w, r, &in) {
		return
	}
	q := in.question()
	compiled, problems := s.compiler.Check(q)
	if len(problems) > 0 {
		writeProblems(w, problems)
		return
	}
	if err := s.store.CreateQuestion(r.Context(), actor.ID, q, compiled); err != nil {
		s.storeError(w, r, err)
		return
	}
	s.respondQuestion(w, r, q.ID, http.StatusCreated)
}

func (s *Server) respondQuestion(w http.ResponseWriter, r *http.Request, id string, status int) {
	record, err := s.store.GetQuestion(r.Context(), id)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, status, record)
}

func (s *Server) getQuestion(w http.ResponseWriter, r *http.Request, _ store.User) {
	s.respondQuestion(w, r, r.PathValue("id"), http.StatusOK)
}

func (s *Server) updateQuestion(w http.ResponseWriter, r *http.Request, actor store.User) {
	var in questionInput
	if !decode(w, r, &in) {
		return
	}
	if in.ID != "" && in.ID != r.PathValue("id") {
		writeProblems(w, catalog.Problems{{Field: "id", Message: "ids are permanent (progress is keyed by them); create a new question instead"}})
		return
	}
	in.ID = r.PathValue("id")
	q := in.question()
	compiled, problems := s.compiler.Check(q)
	if len(problems) > 0 {
		writeProblems(w, problems)
		return
	}
	if _, err := s.store.UpdateQuestion(r.Context(), actor.ID, q, compiled, in.Revision); err != nil {
		s.storeError(w, r, err)
		return
	}
	s.respondQuestion(w, r, q.ID, http.StatusOK)
}

func (s *Server) deleteQuestion(w http.ResponseWriter, r *http.Request, actor store.User) {
	if err := s.store.DeleteQuestion(r.Context(), actor.ID, r.PathValue("id")); err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) listRevisions(w http.ResponseWriter, r *http.Request, _ store.User) {
	revisions, err := s.store.ListRevisions(r.Context(), r.PathValue("id"))
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, revisions)
}

func revisionID(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("rev"), 10, 64)
	return id, err == nil && id > 0
}

func (s *Server) getRevision(w http.ResponseWriter, r *http.Request, _ store.User) {
	rev, ok := revisionID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid", "bad revision id")
		return
	}
	q, err := s.store.GetRevision(r.Context(), r.PathValue("id"), rev)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, q)
}

// restoreRevision brings back an old version: as a new revision if the question
// exists, or re-created (as a draft) if it was deleted.
func (s *Server) restoreRevision(w http.ResponseWriter, r *http.Request, actor store.User) {
	rev, ok := revisionID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid", "bad revision id")
		return
	}
	id := r.PathValue("id")
	q, err := s.store.GetRevision(r.Context(), id, rev)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	current, err := s.store.GetQuestion(r.Context(), id)
	exists := err == nil
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		s.storeError(w, r, err)
		return
	}
	if exists {
		q.SectionID = current.SectionID
		q.Published = current.Published
	} else {
		q.Published = false
	}
	compiled, problems := s.compiler.Check(q)
	if len(problems) > 0 {
		writeProblems(w, problems)
		return
	}
	if exists {
		_, err = s.store.UpdateQuestion(r.Context(), actor.ID, q, compiled, current.Revision)
	} else {
		err = s.store.CreateQuestion(r.Context(), actor.ID, q, compiled)
		if errors.Is(err, store.ErrNoSection) {
			writeError(w, http.StatusConflict, "section_missing", fmt.Sprintf("Its round %q no longer exists. Create a round with that id first, then restore.", q.SectionID))
			return
		}
	}
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	s.respondQuestion(w, r, id, http.StatusOK)
}

func (s *Server) trash(w http.ResponseWriter, r *http.Request, _ store.User) {
	deleted, err := s.store.DeletedQuestions(r.Context())
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, deleted)
}

// preview renders exactly what saving would store, plus every validation problem.
func (s *Server) preview(w http.ResponseWriter, r *http.Request, actor store.User) {
	if !s.limiter.allow(fmt.Sprintf("preview:%d", actor.ID), 240, time.Minute) {
		writeError(w, http.StatusTooManyRequests, "rate_limited", "Previewing too often.")
		return
	}
	var in questionInput
	if !decode(w, r, &in) {
		return
	}
	q := in.question()
	problems := q.Validate()
	compiled, renderProblems := s.compiler.Compile(q)
	problems = append(problems, renderProblems...)
	if problems == nil {
		problems = catalog.Problems{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"html": compiled.HTML, "summary": compiled.Summary, "problems": problems})
}

/* ---------------------------------------------------------------- repository sync & export */

func (s *Server) planSync(w http.ResponseWriter, r *http.Request, _ store.User) {
	p, err := s.store.PlanSync(r.Context(), s.repo)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) applySync(w http.ResponseWriter, r *http.Request, actor store.User) {
	var in struct {
		Overwrite bool `json:"overwrite"`
	}
	if !decode(w, r, &in) {
		return
	}
	p, err := s.store.ApplySync(r.Context(), actor.ID, s.repo, s.compiler.Check, in.Overwrite)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// exportSections loads published content with bodies, in display order.
func (s *Server) exportSections(r *http.Request, onlyID string) ([]catalog.Section, error) {
	idx, err := s.store.Index(r.Context(), false)
	if err != nil {
		return nil, err
	}
	var out []catalog.Section
	for _, meta := range idx.Sections {
		if onlyID != "" && meta.ID != onlyID {
			continue
		}
		sec := catalog.Section{ID: meta.ID, Title: meta.Title, Description: meta.Description, Published: true}
		for _, qm := range meta.Questions {
			q, err := s.store.GetQuestion(r.Context(), qm.ID)
			if err != nil {
				return nil, err
			}
			sec.Questions = append(sec.Questions, q.Question)
		}
		out = append(out, sec)
	}
	return out, nil
}

func (s *Server) exportSection(w http.ResponseWriter, r *http.Request, _ store.User) {
	id := r.PathValue("id")
	sections, err := s.exportSections(r, id)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	if len(sections) == 0 {
		writeError(w, http.StatusNotFound, "not_found", "No published round with that id.")
		return
	}
	idx, _ := s.store.Index(r.Context(), false)
	position := 0
	for i, sec := range idx.Sections {
		if sec.ID == id {
			position = i
		}
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+catalog.ExportFileName(position, id)+`"`)
	_, _ = w.Write([]byte(catalog.ExportFile(sections[0])))
}

// exportAll returns every published round as content/*.md in a zip, ready to commit.
func (s *Server) exportAll(w http.ResponseWriter, r *http.Request, _ store.User) {
	sections, err := s.exportSections(r, "")
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for i, sec := range sections {
		f, err := zw.Create("content/" + catalog.ExportFileName(i, sec.ID))
		if err != nil {
			s.storeError(w, r, err)
			return
		}
		_, _ = f.Write([]byte(catalog.ExportFile(sec)))
	}
	if err := zw.Close(); err != nil {
		s.storeError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="frontend-loop-content.zip"`)
	_, _ = w.Write(buf.Bytes())
}

func (s *Server) listAudit(w http.ResponseWriter, r *http.Request, _ store.User) {
	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	entries, err := s.store.ListAudit(r.Context(), before, 50)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, entries)
}
