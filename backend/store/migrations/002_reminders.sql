-- Email reminders (v2.2).

-- The primary, verified GitHub address (or one given at dev sign-in). '' = unknown.
-- Only the user themself ever sees it; admins don't (it is not in the people list).
ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT '';

CREATE TABLE reminder_prefs (
  user_id           BIGINT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  enabled           BOOLEAN NOT NULL DEFAULT false,
  frequency         TEXT NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('daily', 'every3days', 'weekly')),
  -- Random token in every email's unsubscribe link. It can only switch reminders
  -- off, so it is stored as is (the email must contain the raw value anyway).
  unsubscribe_token TEXT NOT NULL UNIQUE,
  last_sent_at      TIMESTAMPTZ,
  last_error        TEXT NOT NULL DEFAULT '',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reminder_prefs_due_idx ON reminder_prefs (last_sent_at) WHERE enabled;
