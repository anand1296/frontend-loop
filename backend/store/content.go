package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/lib/pq"

	"github.com/anand1296/frontend-loop/backend/catalog"
)

func stringArray(v []string) any { return pq.Array(v) }

// lockContent serializes content writes. Edits are rare and human-paced, so a
// single lock is simpler than reasoning about every interleaving (positions,
// the shared id namespace, the content version counter).
const lockContent int64 = 7_310_003

// QuestionMeta is a question without its answer body.
type QuestionMeta struct {
	ID         string    `json:"id"`
	SectionID  string    `json:"sectionId"`
	Title      string    `json:"title"`
	Level      string    `json:"level"`
	Tags       []string  `json:"tags"`
	Minutes    int       `json:"minutes"`
	Summary    string    `json:"summary"`
	SearchText string    `json:"searchText"`
	Published  bool      `json:"published"`
	Revision   int       `json:"revision"`
	UpdatedAt  time.Time `json:"updatedAt"`
	// Contributor is the login credited for a community-submitted question ("" if none).
	Contributor string `json:"contributor,omitempty"`
}

// SectionMeta is a round with its questions' metadata.
type SectionMeta struct {
	ID          string         `json:"id"`
	Title       string         `json:"title"`
	Description string         `json:"description"`
	Published   bool           `json:"published"`
	UpdatedAt   time.Time      `json:"updatedAt"`
	Questions   []QuestionMeta `json:"questions"`
}

// QuestionRecord is one question as the editor sees it.
type QuestionRecord struct {
	catalog.Question
	Revision  int       `json:"revision"`
	UpdatedAt time.Time `json:"updatedAt"`
	UpdatedBy *string   `json:"updatedBy"`
}

// Index is a consistent snapshot of the content outline.
type Index struct {
	Version  int64         `json:"version"`
	Sections []SectionMeta `json:"sections"`
}

func contentVersion(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}) (int64, error) {
	var v int64
	err := q.QueryRowContext(ctx, `SELECT (value #>> '{}')::bigint FROM settings WHERE key = 'content_version'`).Scan(&v)
	return v, err
}

// ContentVersion changes whenever anything a reader can see changes. Used as the ETag.
func (s *Store) ContentVersion(ctx context.Context) (int64, error) { return contentVersion(ctx, s.db) }

func bumpVersion(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, `UPDATE settings SET value = to_jsonb((value #>> '{}')::bigint + 1), updated_at = now() WHERE key = 'content_version'`)
	return err
}

func lock(ctx context.Context, tx *sql.Tx, key int64) error {
	_, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, key)
	return err
}

// Index returns the outline. Without drafts, unpublished rounds and questions
// (and rounds left with no published questions) are omitted.
func (s *Store) Index(ctx context.Context, includeDrafts bool) (Index, error) {
	var idx Index
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return idx, err
	}
	defer func() { _ = tx.Rollback() }()

	if idx.Version, err = contentVersion(ctx, tx); err != nil {
		return idx, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id, title, description, published, updated_at FROM sections ORDER BY position, id`)
	if err != nil {
		return idx, err
	}
	var sections []SectionMeta
	for rows.Next() {
		var sec SectionMeta
		if err := rows.Scan(&sec.ID, &sec.Title, &sec.Description, &sec.Published, &sec.UpdatedAt); err != nil {
			rows.Close()
			return idx, err
		}
		sec.Questions = []QuestionMeta{}
		sections = append(sections, sec)
	}
	rows.Close()

	positions := map[string]int{}
	for i, sec := range sections {
		positions[sec.ID] = i
	}
	rows, err = tx.QueryContext(ctx, `SELECT q.id, q.section_id, q.title, q.level, q.tags, q.minutes, q.summary, q.search_text, q.published, q.revision, q.updated_at,
		COALESCE(c.login, '')
		FROM questions q LEFT JOIN users c ON c.id = q.contributed_by ORDER BY q.position, q.id`)
	if err != nil {
		return idx, err
	}
	defer rows.Close()
	for rows.Next() {
		var q QuestionMeta
		if err := rows.Scan(&q.ID, &q.SectionID, &q.Title, &q.Level, pq.Array(&q.Tags), &q.Minutes, &q.Summary, &q.SearchText, &q.Published, &q.Revision, &q.UpdatedAt, &q.Contributor); err != nil {
			return idx, err
		}
		if !includeDrafts && !q.Published {
			continue
		}
		if i, ok := positions[q.SectionID]; ok {
			sections[i].Questions = append(sections[i].Questions, q)
		}
	}
	if err := rows.Err(); err != nil {
		return idx, err
	}
	idx.Sections = []SectionMeta{}
	for _, sec := range sections {
		if !includeDrafts && (!sec.Published || len(sec.Questions) == 0) {
			continue
		}
		idx.Sections = append(idx.Sections, sec)
	}
	return idx, nil
}

// SectionAnswers returns question id -> answer HTML for one round.
func (s *Store) SectionAnswers(ctx context.Context, sectionID string, includeDrafts bool) (map[string]string, error) {
	var published bool
	err := s.db.QueryRowContext(ctx, `SELECT published FROM sections WHERE id = $1`, sectionID).Scan(&published)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !published && !includeDrafts) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, html FROM questions WHERE section_id = $1 AND (published OR $2)`, sectionID, includeDrafts)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, html string
		if err := rows.Scan(&id, &html); err != nil {
			return nil, err
		}
		out[id] = html
	}
	return out, rows.Err()
}

func idTaken(ctx context.Context, tx *sql.Tx, id string) (bool, error) {
	var taken bool
	err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM sections WHERE id = $1) OR EXISTS (SELECT 1 FROM questions WHERE id = $1)`, id).Scan(&taken)
	return taken, err
}

// IDTaken reports whether a round or question already uses id.
func (s *Store) IDTaken(ctx context.Context, id string) (bool, error) {
	var taken bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM sections WHERE id = $1) OR EXISTS (SELECT 1 FROM questions WHERE id = $1)`, id).Scan(&taken)
	return taken, err
}

func insertSection(ctx context.Context, tx *sql.Tx, actorID int64, sec catalog.Section) error {
	if taken, err := idTaken(ctx, tx, sec.ID); err != nil {
		return err
	} else if taken {
		return ErrIDTaken
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO sections (id, title, description, position, published, updated_by)
		VALUES ($1, $2, $3, (SELECT COALESCE(MAX(position) + 1, 0) FROM sections), $4, $5)`,
		sec.ID, sec.Title, sec.Description, sec.Published, nullID(actorID))
	return err
}

// CreateSection adds a round at the end.
func (s *Store) CreateSection(ctx context.Context, actorID int64, sec catalog.Section) error {
	return s.inTx(ctx, func(tx *sql.Tx) error {
		if err := lock(ctx, tx, lockContent); err != nil {
			return err
		}
		if err := insertSection(ctx, tx, actorID, sec); err != nil {
			return err
		}
		if err := bumpVersion(ctx, tx); err != nil {
			return err
		}
		return audit(ctx, tx, actorID, "section.created", sec.ID, map[string]any{"title": sec.Title})
	})
}

// GetSection loads a round's own fields.
func (s *Store) GetSection(ctx context.Context, id string) (catalog.Section, error) {
	var sec catalog.Section
	err := s.db.QueryRowContext(ctx, `SELECT id, title, description, published FROM sections WHERE id = $1`, id).
		Scan(&sec.ID, &sec.Title, &sec.Description, &sec.Published)
	if errors.Is(err, sql.ErrNoRows) {
		return sec, ErrNotFound
	}
	return sec, err
}

// UpdateSection replaces a round's title, description and published flag.
func (s *Store) UpdateSection(ctx context.Context, actorID int64, sec catalog.Section) error {
	return s.inTx(ctx, func(tx *sql.Tx) error {
		if err := lock(ctx, tx, lockContent); err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, `UPDATE sections SET title = $2, description = $3, published = $4, updated_at = now(), updated_by = $5 WHERE id = $1`,
			sec.ID, sec.Title, sec.Description, sec.Published, nullID(actorID))
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		if err := bumpVersion(ctx, tx); err != nil {
			return err
		}
		return audit(ctx, tx, actorID, "section.updated", sec.ID, map[string]any{"title": sec.Title, "published": sec.Published})
	})
}

const snapshotSQL = `jsonb_build_object('id', id, 'sectionId', section_id, 'title', title, 'level', level,
	'tags', to_jsonb(tags), 'minutes', minutes, 'body', body, 'published', published)`

// DeleteSection removes a round and its questions. Each question is snapshotted first, so it can be restored.
func (s *Store) DeleteSection(ctx context.Context, actorID int64, id string) error {
	return s.inTx(ctx, func(tx *sql.Tx) error {
		if err := lock(ctx, tx, lockContent); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO question_revisions (question_id, revision, action, snapshot, edited_by)
			SELECT id, revision, 'delete', `+snapshotSQL+`, $2 FROM questions WHERE section_id = $1`, id, nullID(actorID)); err != nil {
			return err
		}
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM questions WHERE section_id = $1`, id).Scan(&count); err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, `DELETE FROM sections WHERE id = $1`, id)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		if err := bumpVersion(ctx, tx); err != nil {
			return err
		}
		return audit(ctx, tx, actorID, "section.deleted", id, map[string]any{"questions": count})
	})
}

func sameSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	seen := map[string]int{}
	for _, v := range a {
		seen[v]++
	}
	for _, v := range b {
		seen[v]--
		if seen[v] < 0 {
			return false
		}
	}
	return true
}

func queryIDs(ctx context.Context, tx *sql.Tx, query string, args ...any) ([]string, error) {
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ReorderSections sets the order of all rounds. ids must list every round exactly once.
func (s *Store) ReorderSections(ctx context.Context, actorID int64, ids []string) error {
	return s.inTx(ctx, func(tx *sql.Tx) error {
		if err := lock(ctx, tx, lockContent); err != nil {
			return err
		}
		current, err := queryIDs(ctx, tx, `SELECT id FROM sections`)
		if err != nil {
			return err
		}
		if !sameSet(current, ids) {
			return ErrInvalidList
		}
		if _, err := tx.ExecContext(ctx, `UPDATE sections s SET position = o.pos FROM unnest($1::text[]) WITH ORDINALITY AS o(id, pos) WHERE s.id = o.id`, pq.Array(ids)); err != nil {
			return err
		}
		if err := bumpVersion(ctx, tx); err != nil {
			return err
		}
		return audit(ctx, tx, actorID, "section.reordered", "", nil)
	})
}

// ReorderQuestions sets the order of one round's questions. ids must list each of them exactly once.
func (s *Store) ReorderQuestions(ctx context.Context, actorID int64, sectionID string, ids []string) error {
	return s.inTx(ctx, func(tx *sql.Tx) error {
		if err := lock(ctx, tx, lockContent); err != nil {
			return err
		}
		current, err := queryIDs(ctx, tx, `SELECT id FROM questions WHERE section_id = $1`, sectionID)
		if err != nil {
			return err
		}
		if !sameSet(current, ids) {
			return ErrInvalidList
		}
		if _, err := tx.ExecContext(ctx, `UPDATE questions q SET position = o.pos FROM unnest($1::text[]) WITH ORDINALITY AS o(id, pos) WHERE q.id = o.id`, pq.Array(ids)); err != nil {
			return err
		}
		if err := bumpVersion(ctx, tx); err != nil {
			return err
		}
		return audit(ctx, tx, actorID, "question.reordered", sectionID, nil)
	})
}

func sectionExists(ctx context.Context, tx *sql.Tx, id string) error {
	var exists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM sections WHERE id = $1)`, id).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("round %q: %w", id, ErrNoSection)
	}
	return nil
}

func insertQuestion(ctx context.Context, tx *sql.Tx, actorID int64, q catalog.Question, c catalog.Compiled) error {
	if err := sectionExists(ctx, tx, q.SectionID); err != nil {
		return err
	}
	if taken, err := idTaken(ctx, tx, q.ID); err != nil {
		return err
	} else if taken {
		return ErrIDTaken
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO questions (id, section_id, position, title, level, tags, minutes, body, html, summary, search_text, published, updated_by)
		VALUES ($1, $2, (SELECT COALESCE(MAX(position) + 1, 0) FROM questions WHERE section_id = $2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		q.ID, q.SectionID, q.Title, q.Level, pq.Array(q.Tags), q.Minutes, q.Body, c.HTML, c.Summary, c.SearchText, q.Published, nullID(actorID))
	return err
}

// CreateQuestion adds a question at the end of its round.
func (s *Store) CreateQuestion(ctx context.Context, actorID int64, q catalog.Question, c catalog.Compiled) error {
	return s.inTx(ctx, func(tx *sql.Tx) error {
		if err := lock(ctx, tx, lockContent); err != nil {
			return err
		}
		if err := insertQuestion(ctx, tx, actorID, q, c); err != nil {
			return err
		}
		if err := bumpVersion(ctx, tx); err != nil {
			return err
		}
		return audit(ctx, tx, actorID, "question.created", q.ID, map[string]any{"section": q.SectionID, "title": q.Title})
	})
}

// GetQuestion loads one question with its Markdown body.
func (s *Store) GetQuestion(ctx context.Context, id string) (QuestionRecord, error) {
	var r QuestionRecord
	var updatedBy sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT q.id, q.section_id, q.title, q.level, q.tags, q.minutes, q.body, q.published, q.revision, q.updated_at, u.login
		FROM questions q LEFT JOIN users u ON u.id = q.updated_by WHERE q.id = $1`, id).
		Scan(&r.ID, &r.SectionID, &r.Title, &r.Level, pq.Array(&r.Tags), &r.Minutes, &r.Body, &r.Published, &r.Revision, &r.UpdatedAt, &updatedBy)
	if errors.Is(err, sql.ErrNoRows) {
		return r, ErrNotFound
	}
	if updatedBy.Valid {
		r.UpdatedBy = &updatedBy.String
	}
	return r, err
}

// UpdateQuestion replaces a question if nobody saved it since expectedRevision.
// The previous version is kept in question_revisions. Moving to another round
// places the question at the end of that round.
func (s *Store) UpdateQuestion(ctx context.Context, actorID int64, q catalog.Question, c catalog.Compiled, expectedRevision int) (int, error) {
	var revision int
	err := s.inTx(ctx, func(tx *sql.Tx) error {
		if err := lock(ctx, tx, lockContent); err != nil {
			return err
		}
		var current int
		var sectionID string
		err := tx.QueryRowContext(ctx, `SELECT revision, section_id FROM questions WHERE id = $1`, q.ID).Scan(&current, &sectionID)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if current != expectedRevision {
			return ErrConflict
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO question_revisions (question_id, revision, action, snapshot, edited_by)
			SELECT id, revision, 'update', `+snapshotSQL+`, $2 FROM questions WHERE id = $1`, q.ID, nullID(actorID)); err != nil {
			return err
		}
		position := `position`
		if q.SectionID != sectionID {
			if err := sectionExists(ctx, tx, q.SectionID); err != nil {
				return err
			}
			position = `(SELECT COALESCE(MAX(position) + 1, 0) FROM questions WHERE section_id = $2)`
		}
		if err := tx.QueryRowContext(ctx, `UPDATE questions SET section_id = $2, position = `+position+`, title = $3, level = $4, tags = $5,
			minutes = $6, body = $7, html = $8, summary = $9, search_text = $10, published = $11, revision = revision + 1,
			updated_at = now(), updated_by = $12 WHERE id = $1 RETURNING revision`,
			q.ID, q.SectionID, q.Title, q.Level, pq.Array(q.Tags), q.Minutes, q.Body, c.HTML, c.Summary, c.SearchText, q.Published, nullID(actorID)).
			Scan(&revision); err != nil {
			return err
		}
		if err := bumpVersion(ctx, tx); err != nil {
			return err
		}
		return audit(ctx, tx, actorID, "question.updated", q.ID, map[string]any{"revision": revision, "published": q.Published})
	})
	return revision, err
}

// DeleteQuestion removes a question after snapshotting it.
func (s *Store) DeleteQuestion(ctx context.Context, actorID int64, id string) error {
	return s.inTx(ctx, func(tx *sql.Tx) error {
		if err := lock(ctx, tx, lockContent); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO question_revisions (question_id, revision, action, snapshot, edited_by)
			SELECT id, revision, 'delete', `+snapshotSQL+`, $2 FROM questions WHERE id = $1`, id, nullID(actorID)); err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, `DELETE FROM questions WHERE id = $1`, id)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		if err := bumpVersion(ctx, tx); err != nil {
			return err
		}
		return audit(ctx, tx, actorID, "question.deleted", id, nil)
	})
}

/* ---------------------------------------------------------------- revisions */

// Revision is one saved previous version of a question.
type Revision struct {
	ID       int64     `json:"id"`
	Revision int       `json:"revision"`
	Action   string    `json:"action"`
	Title    string    `json:"title"`
	EditedBy *string   `json:"editedBy"`
	EditedAt time.Time `json:"editedAt"`
}

// ListRevisions returns a question's history, newest first.
func (s *Store) ListRevisions(ctx context.Context, questionID string) ([]Revision, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT r.id, r.revision, r.action, r.snapshot ->> 'title', u.login, r.edited_at
		FROM question_revisions r LEFT JOIN users u ON u.id = r.edited_by WHERE r.question_id = $1 ORDER BY r.id DESC LIMIT 100`, questionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Revision{}
	for rows.Next() {
		var r Revision
		var by sql.NullString
		if err := rows.Scan(&r.ID, &r.Revision, &r.Action, &r.Title, &by, &r.EditedAt); err != nil {
			return nil, err
		}
		if by.Valid {
			r.EditedBy = &by.String
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetRevision loads a snapshot.
func (s *Store) GetRevision(ctx context.Context, questionID string, revisionID int64) (catalog.Question, error) {
	var raw []byte
	err := s.db.QueryRowContext(ctx, `SELECT snapshot FROM question_revisions WHERE id = $1 AND question_id = $2`, revisionID, questionID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return catalog.Question{}, ErrNotFound
	}
	if err != nil {
		return catalog.Question{}, err
	}
	var q catalog.Question
	return q, json.Unmarshal(raw, &q)
}

// DeletedQuestion is the latest snapshot of a question that no longer exists.
type DeletedQuestion struct {
	Revision
	QuestionID string `json:"questionId"`
	SectionID  string `json:"sectionId"`
}

// DeletedQuestions lists deleted questions that were not re-created, newest first (the "trash").
func (s *Store) DeletedQuestions(ctx context.Context) ([]DeletedQuestion, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT * FROM (
		SELECT DISTINCT ON (r.question_id) r.id, r.revision, r.action, r.snapshot ->> 'title', u.login, r.edited_at,
			r.question_id, r.snapshot ->> 'sectionId'
		FROM question_revisions r LEFT JOIN users u ON u.id = r.edited_by
		WHERE r.action = 'delete' AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.id = r.question_id)
		ORDER BY r.question_id, r.id DESC) latest ORDER BY edited_at DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DeletedQuestion{}
	for rows.Next() {
		var d DeletedQuestion
		var by sql.NullString
		if err := rows.Scan(&d.ID, &d.Revision.Revision, &d.Action, &d.Title, &by, &d.EditedAt, &d.QuestionID, &d.SectionID); err != nil {
			return nil, err
		}
		if by.Valid {
			d.EditedBy = &by.String
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

/* ---------------------------------------------------------------- repository sync */

// SyncPlan describes how the database differs from the repository's content files.
type SyncPlan struct {
	NewSections      []string `json:"newSections"`
	NewQuestions     []string `json:"newQuestions"`
	ChangedQuestions []string `json:"changedQuestions"`
	Unchanged        int      `json:"unchanged"`
	// OnlyInDatabase counts questions created in the console that the repository doesn't have.
	OnlyInDatabase int `json:"onlyInDatabase"`
}

// Empty reports whether applying the plan would change nothing.
func (p SyncPlan) Empty() bool {
	return len(p.NewSections) == 0 && len(p.NewQuestions) == 0 && len(p.ChangedQuestions) == 0
}

type storedQuestion struct {
	sectionID, title, level, body string
	tags                          []string
	minutes                       int
}

func loadStored(ctx context.Context, tx *sql.Tx) (map[string]bool, map[string]storedQuestion, error) {
	sections := map[string]bool{}
	ids, err := queryIDs(ctx, tx, `SELECT id FROM sections`)
	if err != nil {
		return nil, nil, err
	}
	for _, id := range ids {
		sections[id] = true
	}
	rows, err := tx.QueryContext(ctx, `SELECT id, section_id, title, level, tags, minutes, body FROM questions`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	questions := map[string]storedQuestion{}
	for rows.Next() {
		var id string
		var q storedQuestion
		if err := rows.Scan(&id, &q.sectionID, &q.title, &q.level, pq.Array(&q.tags), &q.minutes, &q.body); err != nil {
			return nil, nil, err
		}
		questions[id] = q
	}
	return sections, questions, rows.Err()
}

func differs(stored storedQuestion, q catalog.Question) bool {
	return stored.title != q.Title || stored.level != q.Level || stored.minutes != q.Minutes ||
		stored.body != q.Body || strings.Join(stored.tags, "\x00") != strings.Join(q.Tags, "\x00")
}

func plan(repo []catalog.Section, sections map[string]bool, questions map[string]storedQuestion) SyncPlan {
	p := SyncPlan{NewSections: []string{}, NewQuestions: []string{}, ChangedQuestions: []string{}}
	inRepo := map[string]bool{}
	for _, sec := range repo {
		if !sections[sec.ID] {
			p.NewSections = append(p.NewSections, sec.ID)
		}
		for _, q := range sec.Questions {
			inRepo[q.ID] = true
			stored, ok := questions[q.ID]
			switch {
			case !ok:
				p.NewQuestions = append(p.NewQuestions, q.ID)
			case differs(stored, q):
				p.ChangedQuestions = append(p.ChangedQuestions, q.ID)
			default:
				p.Unchanged++
			}
		}
	}
	for id := range questions {
		if !inRepo[id] {
			p.OnlyInDatabase++
		}
	}
	return p
}

// PlanSync compares the database with the repository content without changing anything.
func (s *Store) PlanSync(ctx context.Context, repo []catalog.Section) (SyncPlan, error) {
	var p SyncPlan
	err := s.inTx(ctx, func(tx *sql.Tx) error {
		sections, questions, err := loadStored(ctx, tx)
		if err != nil {
			return err
		}
		p = plan(repo, sections, questions)
		return nil
	})
	return p, err
}

// CompileFunc renders a question for storage.
type CompileFunc func(catalog.Question) (catalog.Compiled, catalog.Problems)

// ApplySync imports repository content: new rounds and questions are added at
// the end; with overwrite, changed questions take the repository's fields
// (keeping their round, position and published state, with a revision saved).
// Content created in the console is never deleted.
func (s *Store) ApplySync(ctx context.Context, actorID int64, repo []catalog.Section, compile CompileFunc, overwrite bool) (SyncPlan, error) {
	var p SyncPlan
	err := s.inTx(ctx, func(tx *sql.Tx) error {
		if err := lock(ctx, tx, lockContent); err != nil {
			return err
		}
		sections, questions, err := loadStored(ctx, tx)
		if err != nil {
			return err
		}
		p = plan(repo, sections, questions)
		if !overwrite {
			p.ChangedQuestions = []string{}
		}
		if p.Empty() {
			return nil
		}
		changed := map[string]bool{}
		for _, id := range p.ChangedQuestions {
			changed[id] = true
		}
		for _, sec := range repo {
			if !sections[sec.ID] {
				if err := insertSection(ctx, tx, actorID, sec); err != nil {
					return fmt.Errorf("round %s: %w", sec.ID, err)
				}
			}
			for _, q := range sec.Questions {
				_, exists := questions[q.ID]
				if exists && !changed[q.ID] {
					continue
				}
				compiled, problems := compile(q)
				if len(problems) > 0 {
					return fmt.Errorf("question %s: %w", q.ID, problems)
				}
				if !exists {
					if err := insertQuestion(ctx, tx, actorID, q, compiled); err != nil {
						return fmt.Errorf("question %s: %w", q.ID, err)
					}
					continue
				}
				if _, err := tx.ExecContext(ctx, `INSERT INTO question_revisions (question_id, revision, action, snapshot, edited_by)
					SELECT id, revision, 'update', `+snapshotSQL+`, $2 FROM questions WHERE id = $1`, q.ID, nullID(actorID)); err != nil {
					return err
				}
				if _, err := tx.ExecContext(ctx, `UPDATE questions SET title = $2, level = $3, tags = $4, minutes = $5, body = $6, html = $7,
					summary = $8, search_text = $9, revision = revision + 1, updated_at = now(), updated_by = $10 WHERE id = $1`,
					q.ID, q.Title, q.Level, pq.Array(q.Tags), q.Minutes, q.Body, compiled.HTML, compiled.Summary, compiled.SearchText, nullID(actorID)); err != nil {
					return err
				}
			}
		}
		if err := bumpVersion(ctx, tx); err != nil {
			return err
		}
		return audit(ctx, tx, actorID, "content.synced", "repository", map[string]any{
			"newSections": len(p.NewSections), "newQuestions": len(p.NewQuestions), "updated": len(p.ChangedQuestions),
		})
	})
	return p, err
}

// SeedIfEmpty imports the repository content when the database has no rounds yet.
// Safe to call on every cold start: the advisory lock makes concurrent starts wait.
func (s *Store) SeedIfEmpty(ctx context.Context, repo []catalog.Section, compile CompileFunc) (bool, error) {
	seeded := false
	err := s.inTx(ctx, func(tx *sql.Tx) error {
		if err := lock(ctx, tx, lockSeed); err != nil {
			return err
		}
		var exists bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM settings WHERE key = 'seeded')`).Scan(&exists); err != nil {
			return err
		}
		if exists {
			return nil
		}
		for _, sec := range repo {
			if err := insertSection(ctx, tx, 0, sec); err != nil {
				return err
			}
			for _, q := range sec.Questions {
				compiled, problems := compile(q)
				if len(problems) > 0 {
					return fmt.Errorf("seed %s: %w", q.ID, problems)
				}
				if err := insertQuestion(ctx, tx, 0, q, compiled); err != nil {
					return fmt.Errorf("seed %s: %w", q.ID, err)
				}
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO settings (key, value) VALUES ('seeded', to_jsonb(now()))`); err != nil {
			return err
		}
		seeded = true
		return bumpVersion(ctx, tx)
	})
	return seeded, err
}
