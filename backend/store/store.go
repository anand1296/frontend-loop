// Package store is the Postgres data layer. Handlers never write SQL; they
// call these methods, each of which is one transaction with a clear invariant
// (e.g. "a question edit snapshots the previous version and bumps the content
// version, or nothing happens").
//
// Plain database/sql + lib/pq, no ORM: queries stay visible and reviewable,
// and the package is small enough to read in one sitting.
package store

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "github.com/lib/pq" // registers the "postgres" driver
)

// Errors handlers translate into HTTP statuses.
var (
	ErrNotFound    = errors.New("not found")
	ErrConflict    = errors.New("edited by someone else since you opened it")
	ErrIDTaken     = errors.New("that id is already used by a round or question")
	ErrNotInvited  = errors.New("not invited")
	ErrDisabled    = errors.New("account disabled")
	ErrInvalidList = errors.New("the list must contain every item exactly once")
	ErrNoSection   = errors.New("that round doesn't exist")
)

//go:embed migrations/*.sql
var migrations embed.FS

// Store wraps a connection pool.
type Store struct {
	db *sql.DB
}

// Open connects and verifies the connection. Pool sizes suit both a long-running
// server and short-lived serverless instances (which should hold few connections).
func Open(ctx context.Context, url string, maxConns int) (*Store, error) {
	db, err := sql.Open("postgres", url)
	if err != nil {
		return nil, err
	}
	if maxConns <= 0 {
		maxConns = 10
	}
	db.SetMaxOpenConns(maxConns)
	db.SetMaxIdleConns(maxConns)
	db.SetConnMaxIdleTime(2 * time.Minute)
	db.SetConnMaxLifetime(30 * time.Minute)
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("store: connect: %w", err)
	}
	return &Store{db: db}, nil
}

// Close releases the pool.
func (s *Store) Close() error { return s.db.Close() }

// Ping checks the database is reachable (health endpoint).
func (s *Store) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }

// DB exposes the pool for tests.
func (s *Store) DB() *sql.DB { return s.db }

func (s *Store) inTx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

// Lock keys for pg_advisory_xact_lock: one per kind of startup work, so
// concurrent cold starts (several serverless instances) don't race.
const (
	lockMigrate int64 = 7_310_001
	lockSeed    int64 = 7_310_002
)

// Migrate applies pending migrations in order, once, under an advisory lock.
func (s *Store) Migrate(ctx context.Context) error {
	names, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(names)
	return s.inTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, lockMigrate); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
			version INT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
			return err
		}
		applied := map[int]bool{}
		rows, err := tx.QueryContext(ctx, `SELECT version FROM schema_migrations`)
		if err != nil {
			return err
		}
		for rows.Next() {
			var v int
			if err := rows.Scan(&v); err != nil {
				rows.Close()
				return err
			}
			applied[v] = true
		}
		rows.Close()
		for _, name := range names {
			base := strings.TrimPrefix(name, "migrations/")
			version, err := strconv.Atoi(strings.SplitN(base, "_", 2)[0])
			if err != nil {
				return fmt.Errorf("store: migration %s must start with a number", base)
			}
			if applied[version] {
				continue
			}
			sqlText, err := migrations.ReadFile(name)
			if err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, string(sqlText)); err != nil {
				return fmt.Errorf("store: migration %s: %w", base, err)
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, version); err != nil {
				return err
			}
		}
		return nil
	})
}

// Reset drops everything. Tests only.
func (s *Store) Reset(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`)
	return err
}

func nullID(id int64) any {
	if id == 0 {
		return nil
	}
	return id
}
