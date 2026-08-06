-- =============================================================
-- 7.55  users.language — CHECK constraint (defense in depth)
-- -------------------------------------------------------------
-- `language` (TEXT NOT NULL DEFAULT 'en') was added way back in
-- 1.13__users_username-language.sql but never got a CHECK constraint the
-- way 7.50__users_theme_preference.sql's `theme_preference` did — any
-- string was accepted straight into the column. `updateMe` now
-- whitelist-validates to 'th'/'en' before writing (matching how
-- themePreference is validated there), and this migration backs that with
-- the same guarantee at the DB layer, same idempotent existence-check
-- idiom as 7.50 so re-running it is a no-op.
--
-- Existing rows outside {'th','en'} (there shouldn't be any, since the only
-- writer besides updateMe is registration, which always writes 'en') are
-- coerced to 'en' first so the constraint can actually be added.
-- =============================================================

UPDATE users SET language = 'en' WHERE language NOT IN ('th', 'en');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_language_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_language_check
      CHECK (language IN ('th', 'en'));
  END IF;
END $$;
