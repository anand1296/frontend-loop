package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

// Roles, most powerful first. The owner is configured by environment
// (OWNER_GITHUB_LOGIN) and is the only one who can change other people's roles.
const (
	RoleOwner   = "owner"
	RoleAdmin   = "admin"
	RoleLearner = "learner"
)

// User is a person who has signed in at least once.
type User struct {
	ID        int64  `json:"id"`
	GitHubID  *int64 `json:"-"`
	Login     string `json:"login"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatarUrl"`
	Role      string `json:"role"`
	Disabled  bool   `json:"disabled"`
	InvitedBy *int64 `json:"invitedBy"`
	// Email is private to its owner: never serialized into admin views.
	Email      string    `json:"-"`
	CreatedAt  time.Time `json:"createdAt"`
	LastSeenAt time.Time `json:"lastSeenAt"`
}

// IsAdmin reports whether the user may use the admin console.
func (u User) IsAdmin() bool { return u.Role == RoleOwner || u.Role == RoleAdmin }

const userColumns = `id, github_id, login, name, avatar_url, role, disabled, invited_by, created_at, last_seen_at, email`

type scanner interface{ Scan(dest ...any) error }

func scanUser(row scanner) (User, error) {
	var u User
	var githubID, invitedBy sql.NullInt64
	err := row.Scan(&u.ID, &githubID, &u.Login, &u.Name, &u.AvatarURL, &u.Role, &u.Disabled, &invitedBy, &u.CreatedAt, &u.LastSeenAt, &u.Email)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if githubID.Valid {
		u.GitHubID = &githubID.Int64
	}
	if invitedBy.Valid {
		u.InvitedBy = &invitedBy.Int64
	}
	return u, err
}

// Identity is who an identity provider says signed in.
type Identity struct {
	GitHubID  int64 // 0 for dev-login identities
	Login     string
	Name      string
	AvatarURL string
	// Email is a verified address from the provider; "" keeps whatever is stored.
	Email string
}

// SignInOptions carry the policy for a sign-in attempt.
type SignInOptions struct {
	OwnerLogin  string    // lower-cased; this login always becomes (and stays) the owner
	InviteHash  []byte    // optional invite token hash from the invite link
	OpenSignups bool      // site setting: anyone may join as a learner
	Now         time.Time // injected for tests
}

// SignIn finds or creates the user for an identity, applying the invite and
// ownership rules in one transaction. The invite row is locked while it is
// checked and consumed, so a single-use link can't be used twice concurrently.
func (s *Store) SignIn(ctx context.Context, id Identity, opts SignInOptions) (User, error) {
	login := strings.ToLower(strings.TrimSpace(id.Login))
	var user User
	err := s.inTx(ctx, func(tx *sql.Tx) error {
		var err error
		if id.GitHubID != 0 {
			user, err = scanUser(tx.QueryRowContext(ctx, `SELECT `+userColumns+` FROM users WHERE github_id = $1 FOR UPDATE`, id.GitHubID))
		} else {
			user, err = scanUser(tx.QueryRowContext(ctx, `SELECT `+userColumns+` FROM users WHERE login = $1 AND github_id IS NULL FOR UPDATE`, login))
		}
		isOwner := opts.OwnerLogin != "" && login == opts.OwnerLogin

		if err == nil {
			if user.Disabled && !isOwner {
				return ErrDisabled
			}
			role := user.Role
			switch {
			case isOwner:
				role = RoleOwner
			case role == RoleOwner: // owner moved to another account via config
				role = RoleAdmin
			}
			// GitHub logins can be renamed; free the old name if someone else held it.
			if _, err := tx.ExecContext(ctx, `UPDATE users SET login = login || '~' || id WHERE login = $1 AND id <> $2`, login, user.ID); err != nil {
				return err
			}
			user, err = scanUser(tx.QueryRowContext(ctx, `UPDATE users SET login = $2, name = $3, avatar_url = $4, role = $5,
				disabled = false, last_seen_at = $6, email = COALESCE(NULLIF($7, ''), email) WHERE id = $1 RETURNING `+userColumns,
				user.ID, login, id.Name, id.AvatarURL, role, opts.Now, strings.TrimSpace(id.Email)))
			return err
		}
		if !errors.Is(err, ErrNotFound) {
			return err
		}

		role := RoleLearner
		var invitedBy sql.NullInt64
		var inviteID int64
		switch {
		case isOwner:
			role = RoleOwner
		case len(opts.InviteHash) > 0:
			var inviteRole string
			err := tx.QueryRowContext(ctx, `SELECT id, role, created_by FROM invites
				WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2 AND uses < max_uses FOR UPDATE`,
				opts.InviteHash, opts.Now).Scan(&inviteID, &inviteRole, &invitedBy)
			if errors.Is(err, sql.ErrNoRows) {
				if !opts.OpenSignups {
					return ErrNotInvited
				}
			} else if err != nil {
				return err
			} else {
				role = inviteRole
			}
		case !opts.OpenSignups:
			return ErrNotInvited
		}

		var githubID any
		if id.GitHubID != 0 {
			githubID = id.GitHubID
		}
		if _, err := tx.ExecContext(ctx, `UPDATE users SET login = login || '~' || id WHERE login = $1`, login); err != nil {
			return err
		}
		user, err = scanUser(tx.QueryRowContext(ctx, `INSERT INTO users (github_id, login, name, avatar_url, role, invited_by, created_at, last_seen_at, email)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8) RETURNING `+userColumns,
			githubID, login, id.Name, id.AvatarURL, role, invitedBy, opts.Now, strings.TrimSpace(id.Email)))
		if err != nil {
			return err
		}
		if inviteID != 0 {
			if _, err := tx.ExecContext(ctx, `UPDATE invites SET uses = uses + 1 WHERE id = $1`, inviteID); err != nil {
				return err
			}
		}
		return audit(ctx, tx, user.ID, "user.joined", user.Login, map[string]any{"role": role, "invite": inviteID != 0})
	})
	return user, err
}

// GetUser loads one user.
func (s *Store) GetUser(ctx context.Context, id int64) (User, error) {
	return scanUser(s.db.QueryRowContext(ctx, `SELECT `+userColumns+` FROM users WHERE id = $1`, id))
}

// ListUsers returns everyone, newest activity first.
func (s *Store) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+userColumns+` FROM users ORDER BY last_seen_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// UpdateUser changes role and/or disabled state. Disabling also ends the user's sessions.
func (s *Store) UpdateUser(ctx context.Context, actorID, id int64, role *string, disabled *bool) (User, error) {
	var user User
	err := s.inTx(ctx, func(tx *sql.Tx) error {
		current, err := scanUser(tx.QueryRowContext(ctx, `SELECT `+userColumns+` FROM users WHERE id = $1 FOR UPDATE`, id))
		if err != nil {
			return err
		}
		nextRole, nextDisabled := current.Role, current.Disabled
		if role != nil {
			nextRole = *role
		}
		if disabled != nil {
			nextDisabled = *disabled
		}
		user, err = scanUser(tx.QueryRowContext(ctx, `UPDATE users SET role = $2, disabled = $3 WHERE id = $1 RETURNING `+userColumns, id, nextRole, nextDisabled))
		if err != nil {
			return err
		}
		if nextDisabled {
			if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = $1`, id); err != nil {
				return err
			}
		}
		return audit(ctx, tx, actorID, "user.updated", current.Login, map[string]any{"role": nextRole, "disabled": nextDisabled})
	})
	return user, err
}

// DeleteUser removes a user with their sessions and progress.
func (s *Store) DeleteUser(ctx context.Context, actorID, id int64) error {
	return s.inTx(ctx, func(tx *sql.Tx) error {
		var login string
		err := tx.QueryRowContext(ctx, `DELETE FROM users WHERE id = $1 RETURNING login`, id).Scan(&login)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if actorID == id {
			actorID = 0
		}
		return audit(ctx, tx, actorID, "user.deleted", login, nil)
	})
}

/* ---------------------------------------------------------------- sessions */

// CreateSession stores a session by token hash.
func (s *Store) CreateSession(ctx context.Context, userID int64, tokenHash []byte, expires time.Time) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`, tokenHash, userID, expires)
	return err
}

// SessionUser resolves a session to its (enabled) user and refreshes activity at most every 10 minutes.
func (s *Store) SessionUser(ctx context.Context, tokenHash []byte, now time.Time) (User, error) {
	var lastUsed time.Time
	row := s.db.QueryRowContext(ctx, `SELECT s.last_used_at, `+prefixed("u.", userColumns)+`
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = $1 AND s.expires_at > $2 AND NOT u.disabled`, tokenHash, now)
	var u User
	var githubID, invitedBy sql.NullInt64
	err := row.Scan(&lastUsed, &u.ID, &githubID, &u.Login, &u.Name, &u.AvatarURL, &u.Role, &u.Disabled, &invitedBy, &u.CreatedAt, &u.LastSeenAt, &u.Email)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, err
	}
	if invitedBy.Valid {
		u.InvitedBy = &invitedBy.Int64
	}
	if now.Sub(lastUsed) > 10*time.Minute {
		_, _ = s.db.ExecContext(ctx, `UPDATE sessions SET last_used_at = $2 WHERE token_hash = $1`, tokenHash, now)
		_, _ = s.db.ExecContext(ctx, `UPDATE users SET last_seen_at = $2 WHERE id = $1`, u.ID, now)
	}
	return u, nil
}

// DeleteSession signs one session out.
func (s *Store) DeleteSession(ctx context.Context, tokenHash []byte) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = $1`, tokenHash)
	return err
}

// PruneSessions deletes expired sessions.
func (s *Store) PruneSessions(ctx context.Context, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at <= $1`, now)
	return err
}

func prefixed(prefix, columns string) string {
	parts := strings.Split(columns, ", ")
	for i, p := range parts {
		parts[i] = prefix + p
	}
	return strings.Join(parts, ", ")
}

/* ---------------------------------------------------------------- invites */

// Invite is a link that lets someone create an account.
type Invite struct {
	ID        int64      `json:"id"`
	Role      string     `json:"role"`
	Note      string     `json:"note"`
	MaxUses   int        `json:"maxUses"`
	Uses      int        `json:"uses"`
	CreatedBy *string    `json:"createdBy"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt time.Time  `json:"expiresAt"`
	RevokedAt *time.Time `json:"revokedAt"`
	// Token is the raw link token, kept so the owner can copy the link again later. It is
	// never serialised here; the admin handler adds the URL for owners only. Empty for
	// invites created before migration 004.
	Token string `json:"-"`
}

// Status is "active", "used", "expired" or "revoked".
func (i Invite) Status(now time.Time) string {
	switch {
	case i.RevokedAt != nil:
		return "revoked"
	case i.Uses >= i.MaxUses:
		return "used"
	case !i.ExpiresAt.After(now):
		return "expired"
	}
	return "active"
}

const inviteColumns = `i.id, i.role, i.note, i.max_uses, i.uses, u.login, i.created_at, i.expires_at, i.revoked_at, i.token`

func scanInvite(row scanner) (Invite, error) {
	var inv Invite
	var createdBy sql.NullString
	var revoked sql.NullTime
	var token sql.NullString
	err := row.Scan(&inv.ID, &inv.Role, &inv.Note, &inv.MaxUses, &inv.Uses, &createdBy, &inv.CreatedAt, &inv.ExpiresAt, &revoked, &token)
	if errors.Is(err, sql.ErrNoRows) {
		return Invite{}, ErrNotFound
	}
	if createdBy.Valid {
		inv.CreatedBy = &createdBy.String
	}
	inv.Token = token.String
	if revoked.Valid {
		inv.RevokedAt = &revoked.Time
	}
	return inv, err
}

// CreateInvite stores a new invite: the token's hash (used to look it up) and the token
// itself (so the owner can copy the link again).
func (s *Store) CreateInvite(ctx context.Context, actorID int64, token string, tokenHash []byte, role, note string, maxUses int, expires time.Time) (Invite, error) {
	var inv Invite
	err := s.inTx(ctx, func(tx *sql.Tx) error {
		var id int64
		if err := tx.QueryRowContext(ctx, `INSERT INTO invites (token_hash, token, role, note, max_uses, created_by, expires_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, tokenHash, token, role, note, maxUses, nullID(actorID), expires).Scan(&id); err != nil {
			return err
		}
		var err error
		inv, err = scanInvite(tx.QueryRowContext(ctx, `SELECT `+inviteColumns+` FROM invites i LEFT JOIN users u ON u.id = i.created_by WHERE i.id = $1`, id))
		if err != nil {
			return err
		}
		return audit(ctx, tx, actorID, "invite.created", note, map[string]any{"id": id, "role": role, "maxUses": maxUses})
	})
	return inv, err
}

// ListInvites returns invites, newest first.
func (s *Store) ListInvites(ctx context.Context) ([]Invite, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+inviteColumns+` FROM invites i LEFT JOIN users u ON u.id = i.created_by ORDER BY i.id DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Invite
	for rows.Next() {
		inv, err := scanInvite(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, inv)
	}
	return out, rows.Err()
}

// InviteByToken looks an invite up for the public invite page.
func (s *Store) InviteByToken(ctx context.Context, tokenHash []byte) (Invite, error) {
	return scanInvite(s.db.QueryRowContext(ctx, `SELECT `+inviteColumns+` FROM invites i LEFT JOIN users u ON u.id = i.created_by WHERE i.token_hash = $1`, tokenHash))
}

// RevokeInvite stops an invite from being used.
func (s *Store) RevokeInvite(ctx context.Context, actorID, id int64, now time.Time) error {
	return s.inTx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `UPDATE invites SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL`, id, now)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		return audit(ctx, tx, actorID, "invite.revoked", "", map[string]any{"id": id})
	})
}
