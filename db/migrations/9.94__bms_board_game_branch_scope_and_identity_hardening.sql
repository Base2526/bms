-- =============================================================
-- 9.94  Board-game branch scope and checkout hardening
-- -------------------------------------------------------------
-- A plan may be edited after a member buys it, so the bought entitlement must
-- retain its own branch scope.  This migration also replaces several
-- single-column references with tenant-composite references and makes the
-- identity-hold session/location relationship impossible to mismatch.
-- =============================================================

BEGIN;

-- Backfill only when the column is first introduced. Re-running an idempotent
-- migration later must not re-snapshot contracts from a plan that has moved.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'bms_board_game_member_passes'
       AND column_name = 'location_id'
  ) THEN
    ALTER TABLE bms_board_game_member_passes ADD COLUMN location_id UUID;

    -- Best available historical scope is the plan linked at migration time.
    UPDATE bms_board_game_member_passes pass
       SET location_id = plan.location_id
      FROM bms_board_game_pass_plans plan
     WHERE plan.tenant_id = pass.tenant_id
       AND plan.id = pass.plan_id;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_board_game_member_passes_location_fk'
  ) THEN
    ALTER TABLE bms_board_game_member_passes
      ADD CONSTRAINT bms_board_game_member_passes_location_fk
      FOREIGN KEY (tenant_id, location_id)
      REFERENCES bms_locations(tenant_id, id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_board_game_member_passes_customer_tenant_fk'
  ) THEN
    ALTER TABLE bms_board_game_member_passes
      ADD CONSTRAINT bms_board_game_member_passes_customer_tenant_fk
      FOREIGN KEY (tenant_id, customer_id)
      REFERENCES bms_customers(tenant_id, id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_board_game_member_passes_order_tenant_fk'
  ) THEN
    ALTER TABLE bms_board_game_member_passes
      ADD CONSTRAINT bms_board_game_member_passes_order_tenant_fk
      FOREIGN KEY (tenant_id, order_id)
      REFERENCES bms_orders(tenant_id, id) ON DELETE SET NULL (order_id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_board_game_pass_ledger_pass_tenant_fk'
  ) THEN
    ALTER TABLE bms_board_game_pass_ledger
      ADD CONSTRAINT bms_board_game_pass_ledger_pass_tenant_fk
      FOREIGN KEY (tenant_id, pass_id)
      REFERENCES bms_board_game_member_passes(tenant_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_board_game_identity_holds_session_location_fk'
  ) THEN
    ALTER TABLE bms_board_game_identity_holds
      ADD CONSTRAINT bms_board_game_identity_holds_session_location_fk
      FOREIGN KEY (tenant_id, location_id, session_id)
      REFERENCES bms_board_game_sessions(tenant_id, location_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

ALTER TABLE bms_board_game_member_passes
  VALIDATE CONSTRAINT bms_board_game_member_passes_location_fk;
ALTER TABLE bms_board_game_member_passes
  VALIDATE CONSTRAINT bms_board_game_member_passes_customer_tenant_fk;
ALTER TABLE bms_board_game_member_passes
  VALIDATE CONSTRAINT bms_board_game_member_passes_order_tenant_fk;
ALTER TABLE bms_board_game_pass_ledger
  VALIDATE CONSTRAINT bms_board_game_pass_ledger_pass_tenant_fk;
ALTER TABLE bms_board_game_identity_holds
  VALIDATE CONSTRAINT bms_board_game_identity_holds_session_location_fk;

CREATE INDEX IF NOT EXISTS idx_bms_board_game_member_passes_location
  ON bms_board_game_member_passes (tenant_id, location_id, expires_at DESC);

COMMENT ON COLUMN bms_board_game_member_passes.location_id IS
  'Immutable branch scope snapshotted when the pass is issued. NULL means tenant-wide; later plan edits do not move an existing entitlement.';

COMMIT;

-- ROLLBACK:
-- ALTER TABLE bms_board_game_identity_holds DROP CONSTRAINT IF EXISTS bms_board_game_identity_holds_session_location_fk;
-- ALTER TABLE bms_board_game_pass_ledger DROP CONSTRAINT IF EXISTS bms_board_game_pass_ledger_pass_tenant_fk;
-- ALTER TABLE bms_board_game_member_passes DROP CONSTRAINT IF EXISTS bms_board_game_member_passes_order_tenant_fk;
-- ALTER TABLE bms_board_game_member_passes DROP CONSTRAINT IF EXISTS bms_board_game_member_passes_customer_tenant_fk;
-- ALTER TABLE bms_board_game_member_passes DROP CONSTRAINT IF EXISTS bms_board_game_member_passes_location_fk;
-- DROP INDEX IF EXISTS idx_bms_board_game_member_passes_location;
-- ALTER TABLE bms_board_game_member_passes DROP COLUMN IF EXISTS location_id;
