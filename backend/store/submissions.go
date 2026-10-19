package store

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/lib/pq"

	"github.com/anand1296/whetstone/backend/catalog"
)

// Submission statuses.
const (
	SubmissionPending   = "pending"
	SubmissionApproved  = "approved"
	SubmissionRejected  = "rejected"
	SubmissionWithdrawn = "withdrawn"
)

// ErrNotPending means the submission was already reviewed or withdrawn.
var ErrNotPending = errors.New("this submission was already reviewed or withdrawn")

// Submission is a question proposed by a learner, waiting for (or past) review.
type Submission struct {
	ID              int64      `json:"id"`
	UserID          int64      `json:"-"`
	SubmitterLogin  string     `json:"submitter"`
	SubmitterName   string     `json:"submitterName"`
	SectionID       string     `json:"sectionId"`
	NewSectionTitle string     `json:"newSectionTitle"`
	Title           string     `json:"title"`
	Level           string     `json:"level"`
	Tags            []string   `json:"tags"`
	Minutes         int        `json:"minutes"`
	Body            string     `json:"body"`
	Context         string     `json:"context"`
	Credit          bool       `json:"credit"`
	Status          string     `json:"status"`
	ReviewNote      string     `json:"reviewNote"`
	Reviewer        *string    `json:"reviewer"`
	QuestionID      *string    `json:"questionId"`
	CreatedAt       time.Time  `json:"createdAt"`
	ReviewedAt      *time.Time `json:"reviewedAt"`
}

const submissionColumns = `s.id, s.user_id, u.login, u.name, s.section_id, s.new_section_title, s.title, s.level, s.tags, s.minutes,
	s.body, s.context, s.credit, s.status, s.review_note, r.login, s.question_id, s.created_at, s.reviewed_at`

const submissionFrom = ` FROM submissions s JOIN users u ON u.id = s.user_id LEFT JOIN users r ON r.id = s.reviewer_id`

func scanSubmission(row scanner) (Submission, error) {
	var s Submission
	var reviewer, questionID sql.NullString
	var reviewed sql.NullTime
	err := row.Scan(&s.ID, &s.UserID, &s.SubmitterLogin, &s.SubmitterName, &s.SectionID, &s.NewSectionTitle, &s.Title, &s.Level,
		pq.Array(&s.Tags), &s.Minutes, &s.Body, &s.Context, &s.Credit, &s.Status, &s.ReviewNote, &reviewer, &questionID, &s.CreatedAt, &reviewed)
	if errors.Is(err, sql.ErrNoRows) {
		return s, ErrNotFound
	}
	if reviewer.Valid {
		s.Reviewer = &reviewer.String
	}
	if questionID.Valid {
		s.QuestionID = &questionID.String
	}
	if reviewed.Valid {
		s.ReviewedAt = &reviewed.Time
	}
	return s, err
}

// CreateSubmission stores a new pending submission.
func (s *Store) CreateSubmission(ctx context.Context, sub Submission) (Submission, error) {
	var id int64
	err := s.inTx(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx, `INSERT INTO submissions (user_id, section_id, new_section_title, title, level, tags, minutes, body, context, credit)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
			sub.UserID, sub.SectionID, sub.NewSectionTitle, sub.Title, sub.Level, pq.Array(sub.Tags), sub.Minutes, sub.Body, sub.Context, sub.Credit).Scan(&id); err != nil {
			return err
		}
		return audit(ctx, tx, sub.UserID, "submission.created", sub.Title, map[string]any{"id": id})
	})
	if err != nil {
		return Submission{}, err
	}
	return s.GetSubmission(ctx, id)
}

// GetSubmission loads one submission.
func (s *Store) GetSubmission(ctx context.Context, id int64) (Submission, error) {
	return scanSubmission(s.db.QueryRowContext(ctx, `SELECT `+submissionColumns+submissionFrom+` WHERE s.id = $1`, id))
}

func (s *Store) listSubmissions(ctx context.Context, where string, args ...any) ([]Submission, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+submissionColumns+submissionFrom+` WHERE `+where+` ORDER BY s.created_at DESC LIMIT 200`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Submission{}
	for rows.Next() {
		sub, err := scanSubmission(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, sub)
	}
	return out, rows.Err()
}

// UserSubmissions lists one person's submissions, newest first.
func (s *Store) UserSubmissions(ctx context.Context, userID int64) ([]Submission, error) {
	return s.listSubmissions(ctx, `s.user_id = $1`, userID)
}

// SubmissionsByStatus lists submissions for review ("" = all).
func (s *Store) SubmissionsByStatus(ctx context.Context, status string) ([]Submission, error) {
	if status == "" {
		return s.listSubmissions(ctx, `TRUE`)
	}
	return s.listSubmissions(ctx, `s.status = $1`, status)
}

// CountPendingSubmissions is the review queue length (admin badge); with userID > 0, that user's pending count.
func (s *Store) CountPendingSubmissions(ctx context.Context, userID int64) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM submissions WHERE status = 'pending' AND ($1 = 0 OR user_id = $1)`, userID).Scan(&n)
	return n, err
}

// CountRecentSubmissions counts a user's submissions since a time (rate limiting that survives cold starts).
func (s *Store) CountRecentSubmissions(ctx context.Context, userID int64, since time.Time) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM submissions WHERE user_id = $1 AND created_at >= $2`, userID, since).Scan(&n)
	return n, err
}

// WithdrawSubmission lets the submitter take back a pending submission.
func (s *Store) WithdrawSubmission(ctx context.Context, userID, id int64) error {
	res, err := s.db.ExecContext(ctx, `UPDATE submissions SET status = 'withdrawn' WHERE id = $1 AND user_id = $2 AND status = 'pending'`, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotPending
	}
	return nil
}

// RejectSubmission closes a pending submission with a note for the submitter.
func (s *Store) RejectSubmission(ctx context.Context, actorID, id int64, note string, now time.Time) (Submission, error) {
	err := s.inTx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `UPDATE submissions SET status = 'rejected', reviewer_id = $2, review_note = $3, reviewed_at = $4
			WHERE id = $1 AND status = 'pending'`, id, actorID, note, now)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotPending
		}
		return audit(ctx, tx, actorID, "submission.rejected", "", map[string]any{"id": id})
	})
	if err != nil {
		return Submission{}, err
	}
	return s.GetSubmission(ctx, id)
}

// ApproveSubmission creates the question and closes the submission in one
// transaction: either both happen or neither does, so a submission can never
// be "approved" without its question (or approved twice).
func (s *Store) ApproveSubmission(ctx context.Context, actorID, id int64, q catalog.Question, c catalog.Compiled, note string, now time.Time) (Submission, error) {
	err := s.inTx(ctx, func(tx *sql.Tx) error {
		if err := lock(ctx, tx, lockContent); err != nil {
			return err
		}
		var userID int64
		var status string
		var credit bool
		err := tx.QueryRowContext(ctx, `SELECT user_id, status, credit FROM submissions WHERE id = $1 FOR UPDATE`, id).Scan(&userID, &status, &credit)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if status != SubmissionPending {
			return ErrNotPending
		}
		if err := insertQuestion(ctx, tx, actorID, q, c); err != nil {
			return err
		}
		if credit {
			if _, err := tx.ExecContext(ctx, `UPDATE questions SET contributed_by = $2 WHERE id = $1`, q.ID, userID); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE submissions SET status = 'approved', reviewer_id = $2, review_note = $3, reviewed_at = $4, question_id = $5
			WHERE id = $1`, id, actorID, note, now, q.ID); err != nil {
			return err
		}
		if err := bumpVersion(ctx, tx); err != nil {
			return err
		}
		return audit(ctx, tx, actorID, "submission.approved", q.ID, map[string]any{"id": id, "published": q.Published})
	})
	if err != nil {
		return Submission{}, err
	}
	return s.GetSubmission(ctx, id)
}

// OwnerEmail returns the owner's email ("" if unknown), for review notifications.
func (s *Store) OwnerEmail(ctx context.Context) (string, error) {
	var email string
	err := s.db.QueryRowContext(ctx, `SELECT email FROM users WHERE role = 'owner' ORDER BY id LIMIT 1`).Scan(&email)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return email, err
}
