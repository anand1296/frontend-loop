-- Whetstone schema, version 1.
-- Conventions: snake_case, timestamptz everywhere, ids are text slugs for
-- content (they are URL tokens and progress keys) and bigserial for people.

CREATE TABLE users (
  id           BIGSERIAL PRIMARY KEY,
  github_id    BIGINT UNIQUE,                       -- NULL only for dev-login users
  login        TEXT NOT NULL UNIQUE,                -- lower-cased GitHub login
  name         TEXT NOT NULL DEFAULT '',
  avatar_url   TEXT NOT NULL DEFAULT '',
  role         TEXT NOT NULL DEFAULT 'learner' CHECK (role IN ('owner', 'admin', 'learner')),
  disabled     BOOLEAN NOT NULL DEFAULT false,
  invited_by   BIGINT REFERENCES users (id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only the token's SHA-256 is stored: a database leak does not leak sessions.
CREATE TABLE sessions (
  token_hash   BYTEA PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE invites (
  id          BIGSERIAL PRIMARY KEY,
  token_hash  BYTEA NOT NULL UNIQUE,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'learner')),
  note        TEXT NOT NULL DEFAULT '',
  max_uses    INT NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 1000),
  uses        INT NOT NULL DEFAULT 0 CHECK (uses >= 0),
  created_by  BIGINT REFERENCES users (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ
);

CREATE TABLE sections (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  position    INT NOT NULL,
  published   BOOLEAN NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE questions (
  id          TEXT PRIMARY KEY,
  section_id  TEXT NOT NULL REFERENCES sections (id) ON DELETE CASCADE,
  position    INT NOT NULL,
  title       TEXT NOT NULL,
  level       TEXT NOT NULL CHECK (level IN ('senior', 'lead', 'principal')),
  tags        TEXT[] NOT NULL,
  minutes     INT NOT NULL CHECK (minutes BETWEEN 1 AND 120),
  body        TEXT NOT NULL,                        -- Markdown source (what editors edit)
  html        TEXT NOT NULL,                        -- rendered + sanitized at write time
  summary     TEXT NOT NULL,
  search_text TEXT NOT NULL,
  published   BOOLEAN NOT NULL DEFAULT true,
  revision    INT NOT NULL DEFAULT 1,               -- optimistic concurrency token
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX questions_section_idx ON questions (section_id, position);

-- Every edit and delete snapshots the previous version. No FK to questions:
-- history must survive a delete so it can be restored.
CREATE TABLE question_revisions (
  id          BIGSERIAL PRIMARY KEY,
  question_id TEXT NOT NULL,
  revision    INT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('update', 'delete')),
  snapshot    JSONB NOT NULL,
  edited_by   BIGINT REFERENCES users (id) ON DELETE SET NULL,
  edited_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX question_revisions_question_idx ON question_revisions (question_id, id DESC);

CREATE TABLE progress (
  user_id    BIGINT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  doc        JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Small typed documents: announcement, features, site, content_version.
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by BIGINT REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE audit_log (
  id       BIGSERIAL PRIMARY KEY,
  actor_id BIGINT REFERENCES users (id) ON DELETE SET NULL,
  action   TEXT NOT NULL,
  target   TEXT NOT NULL DEFAULT '',
  detail   JSONB NOT NULL DEFAULT '{}',
  at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_at_idx ON audit_log (id DESC);

INSERT INTO settings (key, value) VALUES ('content_version', '1');
