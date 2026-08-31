-- =============================================================
-- 9.39 -- Configurable customer receipt language
-- -------------------------------------------------------------
-- Receipt language is a store policy, not a cashier preference. The same bill
-- must render consistently on screen, ESC/POS, email, and LINE regardless of
-- which staff member is signed in.
-- =============================================================

ALTER TABLE bms_store_profile
  ADD COLUMN IF NOT EXISTS receipt_language_mode TEXT NOT NULL DEFAULT 'th';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_store_profile_receipt_language_mode_check'
       AND conrelid = 'bms_store_profile'::regclass
  ) THEN
    ALTER TABLE bms_store_profile
      ADD CONSTRAINT bms_store_profile_receipt_language_mode_check
      CHECK (receipt_language_mode IN ('th', 'en', 'bilingual'));
  END IF;
END $$;

COMMENT ON COLUMN bms_store_profile.receipt_language_mode IS
  'Customer receipt language shared by POS preview, ESC/POS, email, and LINE: th, en, or bilingual';
