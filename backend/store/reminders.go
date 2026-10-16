package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// Reminder frequencies and the minimum gap between two emails. The gaps are a
// few hours shorter than the nominal period because the daily cron fires
// anywhere within its hour.
var ReminderGaps = map[string]time.Duration{
	"daily":      20 * time.Hour,
	"every3days": 68 * time.Hour,
	"weekly":     164 * time.Hour,
}

// ReminderPrefs is one user's reminder settings.
type ReminderPrefs struct {
	Enabled    bool       `json:"enabled"`
	Frequency  string     `json:"frequency"`
	LastSentAt *time.Time `json:"lastSentAt"`
	LastError  string     `json:"lastError"`
}

// GetReminderPrefs returns the user's settings (off/weekly when never set).
func (s *Store) GetReminderPrefs(ctx context.Context, userID int64) (ReminderPrefs, error) {
	p := ReminderPrefs{Frequency: "weekly"}
	var last sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT enabled, frequency, last_sent_at, last_error FROM reminder_prefs WHERE user_id = $1`, userID).
		Scan(&p.Enabled, &p.Frequency, &last, &p.LastError)
	if errors.Is(err, sql.ErrNoRows) {
		return p, nil
	}
	if last.Valid {
		p.LastSentAt = &last.Time
	}
	return p, err
}

// SetReminderPrefs creates or updates the settings. newToken is used only when
// the row is created (the unsubscribe token then stays stable).
func (s *Store) SetReminderPrefs(ctx context.Context, userID int64, enabled bool, frequency, newToken string) (ReminderPrefs, error) {
	_, err := s.db.ExecContext(ctx, `INSERT INTO reminder_prefs (user_id, enabled, frequency, unsubscribe_token)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id) DO UPDATE SET enabled = EXCLUDED.enabled, frequency = EXCLUDED.frequency, updated_at = now()`,
		userID, enabled, frequency, newToken)
	if err != nil {
		return ReminderPrefs{}, err
	}
	return s.GetReminderPrefs(ctx, userID)
}

// ReminderToken returns the user's unsubscribe token ("" if they never set reminders up).
func (s *Store) ReminderToken(ctx context.Context, userID int64) (string, error) {
	var token string
	err := s.db.QueryRowContext(ctx, `SELECT unsubscribe_token FROM reminder_prefs WHERE user_id = $1`, userID).Scan(&token)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return token, err
}

// ReminderByToken reports whether a token exists and whether reminders are on.
func (s *Store) ReminderByToken(ctx context.Context, token string) (enabled bool, err error) {
	err = s.db.QueryRowContext(ctx, `SELECT enabled FROM reminder_prefs WHERE unsubscribe_token = $1`, token).Scan(&enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return false, ErrNotFound
	}
	return enabled, err
}

// Unsubscribe switches reminders off for the token's owner.
func (s *Store) Unsubscribe(ctx context.Context, token string) error {
	res, err := s.db.ExecContext(ctx, `UPDATE reminder_prefs SET enabled = false, updated_at = now() WHERE unsubscribe_token = $1`, token)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ClaimedReminder is one reminder this run is responsible for sending.
type ClaimedReminder struct {
	UserID    int64
	Token     string
	Frequency string
	// Previous is the last_sent_at before claiming, restored if sending fails.
	Previous *time.Time
}

// ClaimDueReminders atomically marks up to limit due reminders as sent "now" and
// returns them. Claiming before sending (SELECT … FOR UPDATE SKIP LOCKED) means
// two overlapping cron runs never email the same person twice; a failed send is
// rolled back with ReminderFailed so the next run retries it.
func (s *Store) ClaimDueReminders(ctx context.Context, now time.Time, limit int) ([]ClaimedReminder, error) {
	rows, err := s.db.QueryContext(ctx, `
		WITH due AS (
			SELECT rp.user_id, rp.last_sent_at AS previous
			FROM reminder_prefs rp JOIN users u ON u.id = rp.user_id
			WHERE rp.enabled AND NOT u.disabled AND u.email <> ''
			  AND (rp.last_sent_at IS NULL OR rp.last_sent_at <= $1::timestamptz - CASE rp.frequency
			        WHEN 'daily' THEN $3::interval WHEN 'every3days' THEN $4::interval ELSE $5::interval END)
			ORDER BY rp.last_sent_at NULLS FIRST
			LIMIT $2
			FOR UPDATE OF rp SKIP LOCKED
		)
		UPDATE reminder_prefs rp SET last_sent_at = $1
		FROM due WHERE rp.user_id = due.user_id
		RETURNING rp.user_id, rp.unsubscribe_token, rp.frequency, due.previous`,
		now, limit, interval(ReminderGaps["daily"]), interval(ReminderGaps["every3days"]), interval(ReminderGaps["weekly"]))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ClaimedReminder
	for rows.Next() {
		var c ClaimedReminder
		var prev sql.NullTime
		if err := rows.Scan(&c.UserID, &c.Token, &c.Frequency, &prev); err != nil {
			return nil, err
		}
		if prev.Valid {
			c.Previous = &prev.Time
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// interval formats a duration as a Postgres interval literal, e.g. "72000 seconds".
func interval(d time.Duration) string { return fmt.Sprintf("%d seconds", int64(d.Seconds())) }

// ReminderSent clears the last error after a successful send.
func (s *Store) ReminderSent(ctx context.Context, userID int64, at time.Time) error {
	_, err := s.db.ExecContext(ctx, `UPDATE reminder_prefs SET last_sent_at = $2, last_error = '' WHERE user_id = $1`, userID, at)
	return err
}

// ReminderFailed restores the previous send time (so the next run retries) and records why.
func (s *Store) ReminderFailed(ctx context.Context, userID int64, previous *time.Time, reason string) error {
	if len(reason) > 300 {
		reason = reason[:300]
	}
	_, err := s.db.ExecContext(ctx, `UPDATE reminder_prefs SET last_sent_at = $2, last_error = $3 WHERE user_id = $1`, userID, previous, reason)
	return err
}
