-- =============================================================
-- 7.50  User theme preference
-- =============================================================
-- Persist each user's UI theme choice across browsers/devices while
-- preserving the existing local fallback for public and signed-out pages.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS theme_preference TEXT NOT NULL DEFAULT 'system';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_theme_preference_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_theme_preference_check
      CHECK (theme_preference IN ('system', 'light', 'dark'));
  END IF;
END $$;
