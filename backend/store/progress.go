package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/anand1296/frontend-loop/backend/progress"
)

// GetProgress returns a user's progress document (empty if they have none yet).
func (s *Store) GetProgress(ctx context.Context, userID int64) (progress.Doc, error) {
	var raw []byte
	err := s.db.QueryRowContext(ctx, `SELECT doc FROM progress WHERE user_id = $1`, userID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return progress.Empty(), nil
	}
	if err != nil {
		return progress.Doc{}, err
	}
	doc, err := progress.Parse(raw)
	if err != nil {
		return progress.Empty(), nil
	}
	return doc, nil
}

// MergeProgress merges an incoming replica into the stored document and
// returns the result. The row lock makes concurrent saves from two devices
// serialize instead of overwriting each other.
func (s *Store) MergeProgress(ctx context.Context, userID int64, incoming progress.Doc) (progress.Doc, error) {
	var merged progress.Doc
	err := s.inTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO progress (user_id, doc) VALUES ($1, '{"version":1,"questions":{},"lastVisit":null}') ON CONFLICT DO NOTHING`, userID); err != nil {
			return err
		}
		var raw []byte
		if err := tx.QueryRowContext(ctx, `SELECT doc FROM progress WHERE user_id = $1 FOR UPDATE`, userID).Scan(&raw); err != nil {
			return err
		}
		stored, err := progress.Parse(raw)
		if err != nil {
			stored = progress.Empty()
		}
		merged = progress.Merge(stored, incoming)
		out, err := json.Marshal(merged)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `UPDATE progress SET doc = $2, updated_at = now() WHERE user_id = $1`, userID, out)
		return err
	})
	return merged, err
}

// LearnerProgress pairs a user with their progress document.
type LearnerProgress struct {
	User      User
	Doc       progress.Doc
	UpdatedAt *time.Time
}

// AllProgress returns every user with their progress (for the admin dashboard).
func (s *Store) AllProgress(ctx context.Context) ([]LearnerProgress, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+prefixed("u.", userColumns)+`, p.doc, p.updated_at
		FROM users u LEFT JOIN progress p ON p.user_id = u.id ORDER BY COALESCE(p.updated_at, u.last_seen_at) DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LearnerProgress
	for rows.Next() {
		var lp LearnerProgress
		var githubID, invitedBy sql.NullInt64
		var raw []byte
		var updated sql.NullTime
		u := &lp.User
		if err := rows.Scan(&u.ID, &githubID, &u.Login, &u.Name, &u.AvatarURL, &u.Role, &u.Disabled, &invitedBy, &u.CreatedAt, &u.LastSeenAt, &u.Email, &raw, &updated); err != nil {
			return nil, err
		}
		if invitedBy.Valid {
			u.InvitedBy = &invitedBy.Int64
		}
		lp.Doc = progress.Empty()
		if raw != nil {
			if doc, err := progress.Parse(raw); err == nil {
				lp.Doc = doc
			}
		}
		if updated.Valid {
			lp.UpdatedAt = &updated.Time
		}
		out = append(out, lp)
	}
	return out, rows.Err()
}
