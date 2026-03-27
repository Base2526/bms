ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN;

UPDATE users
SET notifications_enabled = TRUE
WHERE notifications_enabled IS NULL;

ALTER TABLE users
  ALTER COLUMN notifications_enabled SET DEFAULT TRUE;

ALTER TABLE users
  ALTER COLUMN notifications_enabled SET NOT NULL;
