-- Community question submissions (v2.3).

-- Credit for questions that came from a submission (only when the submitter opted in).
ALTER TABLE questions ADD COLUMN contributed_by BIGINT REFERENCES users (id) ON DELETE SET NULL;

CREATE TABLE submissions (
  id                BIGSERIAL PRIMARY KEY,
  user_id           BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The round it was proposed for. Not a foreign key: the round may be renamed or deleted
  -- while the submission waits; the reviewer picks the final round when approving.
  section_id        TEXT NOT NULL DEFAULT '',
  new_section_title TEXT NOT NULL DEFAULT '',          -- "suggest a new round"
  title             TEXT NOT NULL,
  level             TEXT NOT NULL CHECK (level IN ('senior', 'lead', 'principal')),
  tags              TEXT[] NOT NULL,
  minutes           INT NOT NULL CHECK (minutes BETWEEN 1 AND 120),
  body              TEXT NOT NULL,                     -- Markdown answer, same format as the bank
  context           TEXT NOT NULL DEFAULT '',          -- private note for the reviewer; never published
  credit            BOOLEAN NOT NULL DEFAULT true,     -- show "Contributed by @login" if published
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  reviewer_id       BIGINT REFERENCES users (id) ON DELETE SET NULL,
  review_note       TEXT NOT NULL DEFAULT '',
  question_id       TEXT,                              -- the question it became
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at       TIMESTAMPTZ
);
CREATE INDEX submissions_status_idx ON submissions (status, created_at DESC);
CREATE INDEX submissions_user_idx ON submissions (user_id, created_at DESC);
