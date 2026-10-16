package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

// GetSetting decodes one settings document into dst. found is false when it was never set.
func (s *Store) GetSetting(ctx context.Context, key string, dst any) (found bool, err error) {
	var raw []byte
	err = s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = $1`, key).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, json.Unmarshal(raw, dst)
}

// GetSettings loads several settings at once (raw JSON by key).
func (s *Store) GetSettings(ctx context.Context, keys ...string) (map[string]json.RawMessage, error) {
	out := map[string]json.RawMessage{}
	rows, err := s.db.QueryContext(ctx, `SELECT key, value FROM settings WHERE key = ANY($1)`, stringArray(keys))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var raw []byte
		if err := rows.Scan(&key, &raw); err != nil {
			return nil, err
		}
		out[key] = raw
	}
	return out, rows.Err()
}

// PutSetting replaces one settings document and records who changed it.
func (s *Store) PutSetting(ctx context.Context, actorID int64, key string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return s.inTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ($1, $2, now(), $3)
			ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
			key, raw, nullID(actorID)); err != nil {
			return err
		}
		return audit(ctx, tx, actorID, "settings.updated", key, nil)
	})
}

/* ---------------------------------------------------------------- audit log */

// AuditEntry is one recorded admin action.
type AuditEntry struct {
	ID     int64           `json:"id"`
	Actor  *string         `json:"actor"`
	Action string          `json:"action"`
	Target string          `json:"target"`
	Detail json.RawMessage `json:"detail"`
	At     time.Time       `json:"at"`
}

func audit(ctx context.Context, tx *sql.Tx, actorID int64, action, target string, detail map[string]any) error {
	if detail == nil {
		detail = map[string]any{}
	}
	raw, err := json.Marshal(detail)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO audit_log (actor_id, action, target, detail) VALUES ($1, $2, $3, $4)`, nullID(actorID), action, target, raw)
	return err
}

// ListAudit pages backwards through the log. before = 0 starts at the newest entry.
func (s *Store) ListAudit(ctx context.Context, before int64, limit int) ([]AuditEntry, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if before <= 0 {
		before = 1<<62 - 1
	}
	rows, err := s.db.QueryContext(ctx, `SELECT a.id, u.login, a.action, a.target, a.detail, a.at
		FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE a.id < $1 ORDER BY a.id DESC LIMIT $2`, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AuditEntry{}
	for rows.Next() {
		var e AuditEntry
		var actor sql.NullString
		var detail []byte
		if err := rows.Scan(&e.ID, &actor, &e.Action, &e.Target, &detail, &e.At); err != nil {
			return nil, err
		}
		if actor.Valid {
			e.Actor = &actor.String
		}
		e.Detail = detail
		out = append(out, e)
	}
	return out, rows.Err()
}
