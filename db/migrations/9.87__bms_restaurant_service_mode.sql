-- =============================================================
-- 9.87  Restaurant service mode for dine-in and takeaway checks
-- -------------------------------------------------------------
-- Restaurant checks are service state before a POS order is settled. Dine-in
-- checks belong to a table; takeaway checks belong to the branch queue and
-- deliberately have no table/QR identity. The final order keeps a snapshot so
-- receipts, reprints and reports do not infer the service mode later.
-- =============================================================

BEGIN;

ALTER TABLE bms_restaurant_checks
  ADD COLUMN IF NOT EXISTS service_mode TEXT NOT NULL DEFAULT 'DINE_IN',
  ALTER COLUMN table_id DROP NOT NULL;

DO $$
BEGIN
  ALTER TABLE bms_restaurant_checks
    ADD CONSTRAINT bms_restaurant_checks_service_mode_chk
    CHECK (service_mode IN ('DINE_IN', 'TAKEAWAY'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE bms_restaurant_checks
    ADD CONSTRAINT bms_restaurant_checks_service_shape
    CHECK (
      (service_mode = 'DINE_IN' AND table_id IS NOT NULL)
      OR (service_mode = 'TAKEAWAY' AND table_id IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP INDEX IF EXISTS uq_bms_restaurant_checks_open_table;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_restaurant_checks_open_table
  ON bms_restaurant_checks (tenant_id, table_id, split_group_no)
  WHERE table_id IS NOT NULL AND status IN ('OPEN', 'CLOSING');

CREATE INDEX IF NOT EXISTS idx_bms_restaurant_checks_takeaway_open
  ON bms_restaurant_checks (tenant_id, location_id, opened_at DESC)
  WHERE service_mode = 'TAKEAWAY' AND status IN ('OPEN', 'CLOSING');

ALTER TABLE bms_orders
  ADD COLUMN IF NOT EXISTS restaurant_service_mode TEXT;

DO $$
BEGIN
  ALTER TABLE bms_orders
    ADD CONSTRAINT bms_orders_restaurant_service_mode_chk
    CHECK (restaurant_service_mode IS NULL OR restaurant_service_mode IN ('DINE_IN', 'TAKEAWAY'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN bms_restaurant_checks.service_mode IS
  'DINE_IN checks require a restaurant table; TAKEAWAY checks are branch queue checks with no table.';
COMMENT ON COLUMN bms_orders.restaurant_service_mode IS
  'Snapshot of restaurant check service mode for receipts/reprints; separate from online fulfillment_type.';

COMMIT;

-- ROLLBACK:
-- ALTER TABLE bms_orders DROP COLUMN IF EXISTS restaurant_service_mode;
-- DROP INDEX IF EXISTS idx_bms_restaurant_checks_takeaway_open;
-- DROP INDEX IF EXISTS uq_bms_restaurant_checks_open_table;
-- CREATE UNIQUE INDEX uq_bms_restaurant_checks_open_table
--   ON bms_restaurant_checks (tenant_id, table_id, split_group_no)
--   WHERE status IN ('OPEN', 'CLOSING');
-- ALTER TABLE bms_restaurant_checks
--   DROP CONSTRAINT IF EXISTS bms_restaurant_checks_service_shape,
--   DROP CONSTRAINT IF EXISTS bms_restaurant_checks_service_mode_chk,
--   DROP COLUMN IF EXISTS service_mode,
--   ALTER COLUMN table_id SET NOT NULL;
