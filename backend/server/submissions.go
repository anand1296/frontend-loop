package server

import (
	"context"
	"errors"
	"fmt"
	"html/template"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/anand1296/whetstone/backend/catalog"
	"github.com/anand1296/whetstone/backend/mail"
	"github.com/anand1296/whetstone/backend/store"
)

// Community question submissions: any signed-in person proposes a question
// from their interviews; it waits in the admin console until an admin
// approves it (it becomes a real question, optionally credited) or rejects
// it with a note. Nothing reaches learners without review.

const (
	submissionsPerDay  = 5
	maxPendingPerUser  = 10
	maxContext         = 1000
	maxNewSectionTitle = 120
)

type submissionInput struct {
	SectionID       string   `json:"sectionId"`
	NewSectionTitle string   `json:"newSectionTitle"`
	Title           string   `json:"title"`
	Level           string   `json:"level"`
	Tags            []string `json:"tags"`
	Minutes         int      `json:"minutes"`
	Body            string   `json:"body"`
	Context         string   `json:"context"`
	Credit          bool     `json:"credit"`
}

// checkSubmission validates a submission against the same bar as published questions
// (so approving is quick), plus the submission-only fields.
func (s *Server) checkSubmission(ctx context.Context, in *submissionInput) (catalog.Compiled, catalog.Problems, error) {
	in.SectionID = strings.TrimSpace(in.SectionID)
	in.NewSectionTitle = strings.TrimSpace(in.NewSectionTitle)
	in.Context = strings.TrimSpace(in.Context)
	if in.Minutes == 0 {
		in.Minutes = 10
	}
	q := catalog.Question{ID: "submission", SectionID: in.SectionID, Title: in.Title, Level: in.Level, Tags: in.Tags, Minutes: in.Minutes, Body: in.Body, Published: true}
	q.Normalize()
	in.Title, in.Level, in.Tags, in.Body = q.Title, q.Level, q.Tags, q.Body
	compiled, problems := s.compiler.Check(q)
	switch {
	case in.NewSectionTitle != "":
		in.SectionID = ""
		if n := utf8.RuneCountInString(in.NewSectionTitle); n < 3 || n > maxNewSectionTitle {
			problems = append(problems, catalog.FieldError{Field: "newSectionTitle", Message: fmt.Sprintf("must be 3 to %d characters", maxNewSectionTitle)})
		}
	case in.SectionID == "":
		problems = append(problems, catalog.FieldError{Field: "sectionId", Message: "pick a round, or suggest a new one"})
	default:
		idx, err := s.store.Index(ctx, false)
		if err != nil {
			return compiled, nil, err
		}
		found := false
		for _, sec := range idx.Sections {
			found = found || sec.ID == in.SectionID
		}
		if !found {
			problems = append(problems, catalog.FieldError{Field: "sectionId", Message: "that round doesn't exist"})
		}
	}
	if utf8.RuneCountInString(in.Context) > maxContext {
		problems = append(problems, catalog.FieldError{Field: "context", Message: fmt.Sprintf("must be at most %d characters", maxContext)})
	}
	return compiled, problems, nil
}

func (s *Server) contributeOn(r *http.Request) bool {
	return s.settings(r.Context()).features["contribute"]
}

func (s *Server) previewSubmission(w http.ResponseWriter, r *http.Request, user store.User) {
	if !s.limiter.allow(fmt.Sprintf("submission-preview:%d", user.ID), 120, time.Minute) {
		writeError(w, http.StatusTooManyRequests, "rate_limited", "Previewing too often.")
		return
	}
	var in submissionInput
	if !decode(w, r, &in) {
		return
	}
	compiled, problems, err := s.checkSubmission(r.Context(), &in)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	if problems == nil {
		problems = catalog.Problems{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"html": compiled.HTML, "problems": problems})
}

func (s *Server) createSubmission(w http.ResponseWriter, r *http.Request, user store.User) {
	if !s.contributeOn(r) {
		writeError(w, http.StatusForbidden, "disabled", "Submissions are switched off for this site.")
		return
	}
	var in submissionInput
	if !decode(w, r, &in) {
		return
	}
	since := s.now().Add(-24 * time.Hour)
	recent, err := s.store.CountRecentSubmissions(r.Context(), user.ID, since)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	pending, err := s.store.CountPendingSubmissions(r.Context(), user.ID)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	if recent >= submissionsPerDay || pending >= maxPendingPerUser {
		writeError(w, http.StatusTooManyRequests, "rate_limited", fmt.Sprintf("You can send %d questions a day and have %d waiting for review at a time. Thank you for the enthusiasm!", submissionsPerDay, maxPendingPerUser))
		return
	}
	_, problems, err := s.checkSubmission(r.Context(), &in)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	if len(problems) > 0 {
		writeProblems(w, problems)
		return
	}
	sub, err := s.store.CreateSubmission(r.Context(), store.Submission{
		UserID: user.ID, SectionID: in.SectionID, NewSectionTitle: in.NewSectionTitle, Title: in.Title, Level: in.Level,
		Tags: in.Tags, Minutes: in.Minutes, Body: in.Body, Context: in.Context, Credit: in.Credit,
	})
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	s.notifyOwnerOfSubmission(r, sub)
	writeJSON(w, http.StatusCreated, sub)
}

func (s *Server) mySubmissions(w http.ResponseWriter, r *http.Request, user store.User) {
	subs, err := s.store.UserSubmissions(r.Context(), user.ID)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, subs)
}

func (s *Server) withdrawSubmission(w http.ResponseWriter, r *http.Request, user store.User) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid", "bad submission id")
		return
	}
	if err := s.store.WithdrawSubmission(r.Context(), user.ID, id); err != nil {
		s.submissionError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) submissionError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, store.ErrNotPending) {
		writeError(w, http.StatusConflict, "not_pending", err.Error())
		return
	}
	s.storeError(w, r, err)
}

/* ---------------------------------------------------------------- admin review */

func (s *Server) listSubmissions(w http.ResponseWriter, r *http.Request, _ store.User) {
	status := r.URL.Query().Get("status")
	if status == "all" {
		status = ""
	} else if status == "" {
		status = store.SubmissionPending
	}
	subs, err := s.store.SubmissionsByStatus(r.Context(), status)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, subs)
}

func (s *Server) getSubmission(w http.ResponseWriter, r *http.Request, _ store.User) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid", "bad submission id")
		return
	}
	sub, err := s.store.GetSubmission(r.Context(), id)
	if err != nil {
		s.storeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, sub)
}

// approveSubmission turns a submission into a question. The reviewer sends the
// final question (they may have edited the wording, picked the round, set the
// id, or kept it as a draft); the store creates it and closes the submission
// in one transaction.
func (s *Server) approveSubmission(w http.ResponseWriter, r *http.Request, actor store.User) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid", "bad submission id")
		return
	}
	var body struct {
		Question questionInput `json:"question"`
		Note     string        `json:"note"`
	}
	if !decode(w, r, &body) {
		return
	}
	q := body.Question.question()
	compiled, problems := s.compiler.Check(q)
	if len(problems) > 0 {
		writeProblems(w, problems)
		return
	}
	sub, err := s.store.ApproveSubmission(r.Context(), actor.ID, id, q, compiled, strings.TrimSpace(body.Note), s.now())
	if err != nil {
		s.submissionError(w, r, err)
		return
	}
	s.notifySubmitter(r, sub)
	writeJSON(w, http.StatusOK, sub)
}

func (s *Server) rejectSubmission(w http.ResponseWriter, r *http.Request, actor store.User) {
	id, ok := pathID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid", "bad submission id")
		return
	}
	var body struct {
		Note string `json:"note"`
	}
	if !decode(w, r, &body) {
		return
	}
	note := strings.TrimSpace(body.Note)
	if utf8.RuneCountInString(note) > 1000 {
		writeError(w, http.StatusUnprocessableEntity, "invalid", "note must be at most 1000 characters")
		return
	}
	sub, err := s.store.RejectSubmission(r.Context(), actor.ID, id, note, s.now())
	if err != nil {
		s.submissionError(w, r, err)
		return
	}
	s.notifySubmitter(r, sub)
	writeJSON(w, http.StatusOK, sub)
}

/* ---------------------------------------------------------------- notifications */

var noticeTemplate = template.Must(template.New("notice").Parse(`<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#161b2e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #dde1ea;border-radius:14px"><tr><td style="padding:28px">
<p style="margin:0 0 16px;font-weight:700;color:#3346d3">{{.Site}}</p>
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.35">{{.Heading}}</h1>
{{range .Lines}}<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#464e66">{{.}}</p>{{end}}
<a href="{{.URL}}" style="display:inline-block;margin-top:8px;background:#3346d3;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:8px">{{.Button}}</a>
</td></tr></table></td></tr></table></body></html>`))

type notice struct {
	Site, Heading, URL, Button string
	Lines                      []string
}

// send delivers a transactional notice. Best effort: a mail problem never
// fails the request that triggered it (the state change already happened).
func (s *Server) send(r *http.Request, to, subject string, n notice) {
	if to == "" || !s.mailer.Configured() {
		return
	}
	n.Site = s.siteSettings(r.Context()).Name
	var html strings.Builder
	if err := noticeTemplate.Execute(&html, n); err != nil {
		return
	}
	text := n.Heading + "\n\n" + strings.Join(n.Lines, "\n\n") + "\n\n" + n.Button + ": " + n.URL + "\n"
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 8*time.Second)
	defer cancel()
	if err := s.mailer.Send(ctx, mail.Message{To: to, Subject: subject, Text: text, HTML: html.String()}); err != nil {
		s.log.WarnContext(r.Context(), "notification failed", "subject", subject, "err", err)
	}
}

func (s *Server) notifyOwnerOfSubmission(r *http.Request, sub store.Submission) {
	email, err := s.store.OwnerEmail(r.Context())
	if err != nil || email == "" {
		return
	}
	round := sub.SectionID
	if sub.NewSectionTitle != "" {
		round = "new round: " + sub.NewSectionTitle
	}
	s.send(r, email, "New question to review: "+sub.Title, notice{
		Heading: "@" + sub.SubmitterLogin + " submitted a question",
		Lines:   []string{"“" + sub.Title + "” (" + sub.Level + ", " + round + ")", "It's waiting in Admin → Submissions. Nothing is published until you approve it."},
		URL:     s.appURL(r) + "/#admin",
		Button:  "Review it",
	})
}

func (s *Server) notifySubmitter(r *http.Request, sub store.Submission) {
	user, err := s.store.GetUser(r.Context(), sub.UserID)
	if err != nil || user.Email == "" {
		return
	}
	if sub.Status == store.SubmissionApproved && sub.QuestionID != nil {
		lines := []string{"“" + sub.Title + "” has been reviewed and added to the question bank. Thank you for sharing it with everyone preparing."}
		if sub.ReviewNote != "" {
			lines = append(lines, "Note from the reviewer: "+sub.ReviewNote)
		}
		s.send(r, user.Email, "Your question was accepted: "+sub.Title, notice{
			Heading: "Your question made it in", Lines: lines, URL: s.appURL(r) + "/#" + *sub.QuestionID, Button: "See it in the app",
		})
		return
	}
	lines := []string{"Thanks for submitting “" + sub.Title + "”. This one won't be added to the bank."}
	if sub.ReviewNote != "" {
		lines = append(lines, "Note from the reviewer: "+sub.ReviewNote)
	}
	s.send(r, user.Email, "About your question: "+sub.Title, notice{
		Heading: "Your submission was reviewed", Lines: lines, URL: s.appURL(r) + "/#contribute", Button: "Open Contribute",
	})
}
