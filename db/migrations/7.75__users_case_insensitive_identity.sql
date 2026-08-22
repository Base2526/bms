BEGIN;

-- Refuse to guess which existing account should survive. Operators must resolve any historical
-- case-only duplicates before this migration can safely make login identity case-insensitive.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM users
     WHERE email IS NOT NULL AND btrim(email) <> ''
     GROUP BY lower(btrim(email)) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'users contains case-insensitive duplicate emails; resolve the accounts before migration 7.75';
  END IF;
  IF EXISTS (
    SELECT 1 FROM users
     WHERE username IS NOT NULL AND btrim(username) <> ''
     GROUP BY lower(btrim(username)) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'users contains case-insensitive duplicate usernames; resolve the accounts before migration 7.75';
  END IF;
END $$;

UPDATE users SET email = NULL WHERE email IS NOT NULL AND btrim(email) = '';
UPDATE users SET username = NULL WHERE username IS NOT NULL AND btrim(username) = '';
UPDATE users SET email = lower(btrim(email)) WHERE email IS NOT NULL;
UPDATE users SET username = lower(btrim(username)) WHERE username IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_case_insensitive_uidx
  ON users (lower(btrim(email)))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_case_insensitive_uidx
  ON users (lower(btrim(username)))
  WHERE username IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_email_canonical_chk') THEN
    ALTER TABLE users ADD CONSTRAINT users_email_canonical_chk
      CHECK (email IS NULL OR (email <> '' AND email = lower(btrim(email))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_username_canonical_chk') THEN
    ALTER TABLE users ADD CONSTRAINT users_username_canonical_chk
      CHECK (username IS NULL OR (username <> '' AND username = lower(btrim(username))));
  END IF;
END $$;

COMMIT;
