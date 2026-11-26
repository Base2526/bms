-- 10.143: explicitly revoke an active clinic emergency grant before its 15-minute expiry.
-- Keep expires_at shortened on revocation so an older app that ignores revoked_at
-- cannot reopen access during an application rollback.
BEGIN;
ALTER TABLE bms_clinic_break_glass
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'bms_clinic_break_glass'::regclass
      AND conname = 'bms_clinic_break_glass_revoked_by_fkey') THEN
    ALTER TABLE bms_clinic_break_glass
      ADD CONSTRAINT bms_clinic_break_glass_revoked_by_fkey
      FOREIGN KEY (tenant_id,revoked_by) REFERENCES users(tenant_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'bms_clinic_break_glass'::regclass
      AND conname = 'bms_clinic_break_glass_revocation_pair_check') THEN
    ALTER TABLE bms_clinic_break_glass
      ADD CONSTRAINT bms_clinic_break_glass_revocation_pair_check
      CHECK ((revoked_at IS NULL) = (revoked_by IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'bms_clinic_break_glass'::regclass
      AND conname = 'bms_clinic_break_glass_revoked_expiry_check') THEN
    ALTER TABLE bms_clinic_break_glass
      ADD CONSTRAINT bms_clinic_break_glass_revoked_expiry_check
      CHECK (revoked_at IS NULL OR (revoked_at >= granted_at AND expires_at <= revoked_at));
  END IF;
END $$;
GRANT UPDATE (expires_at,revoked_at,revoked_by) ON bms_clinic_break_glass TO bms_app;
COMMIT;

-- ROLLBACK: deploy the previous application without dropping these columns or
-- restoring expires_at. Already revoked grants remain expired for the old code.
