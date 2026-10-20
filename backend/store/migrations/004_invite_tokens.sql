-- Keep the raw invite token so the owner can copy a link again after creating it.
-- Nullable: invites created before this migration only have a hash and cannot be shown.
ALTER TABLE invites ADD COLUMN token TEXT;
