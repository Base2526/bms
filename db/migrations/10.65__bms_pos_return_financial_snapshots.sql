-- Apply BEFORE deploying the return writer / evidence reader. No historical backfill.
BEGIN;
ALTER TABLE bms_pos_returns ADD COLUMN IF NOT EXISTS financial_snapshot JSONB;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='bms_pos_returns'::regclass
    AND conname='bms_pos_return_financial_snapshot_check') THEN
    ALTER TABLE bms_pos_returns ADD CONSTRAINT bms_pos_return_financial_snapshot_check
      CHECK (financial_snapshot IS NULL OR (jsonb_typeof(financial_snapshot)='object'
        AND financial_snapshot @> '{"version":1}'::jsonb
        AND financial_snapshot ?& ARRAY['amount','source','lines','components','tax','issues','policy','vatBasis']));
  END IF;
END $$;
-- Existing table tenant RLS and bms_app table grants cover this column. This trigger reads
-- only its own table, uses caller rights, and performs no queries/outbox writes.
CREATE OR REPLACE FUNCTION bms_pos_return_snapshot_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.financial_snapshot IS DISTINCT FROM OLD.financial_snapshot THEN
    RAISE EXCEPTION 'POS return financial snapshot is immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bms_pos_return_snapshot_immutable ON bms_pos_returns;
CREATE TRIGGER bms_pos_return_snapshot_immutable BEFORE UPDATE OF financial_snapshot
  ON bms_pos_returns FOR EACH ROW EXECUTE FUNCTION bms_pos_return_snapshot_immutable();
COMMENT ON COLUMN bms_pos_returns.financial_snapshot IS
  'v1 immutable return-time component evidence. Signed rounding is outside VAT; VAT is an allocation of frozen sale buckets, not a credit note. NULL legacy is unknown, never backfilled.';
COMMIT;
-- ROLLBACK: roll back application first; retain column and evidence. If the guard must be
-- disabled: DROP TRIGGER IF EXISTS bms_pos_return_snapshot_immutable ON bms_pos_returns;
-- Do not drop financial_snapshot or backfill legacy rows from current settings.
