-- =============================================================
-- 9.15  Data-integrity lifecycle timestamps + numeric hardening
-- -------------------------------------------------------------
-- created_at answers when a record was opened, not when money was received,
-- rejected, refunded, cancelled, or returned.  Keeping those events only in
-- updated_at makes a cross-day event impossible to attribute to the correct
-- Asia/Bangkok business date and lets later edits overwrite the only evidence.
--
-- Existing rows are backfilled from updated_at as the best available legacy
-- approximation.  New transitions write the exact event timestamp in the
-- service transaction.
-- =============================================================

ALTER TABLE bms_orders
  ADD COLUMN IF NOT EXISTS paid_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS returned_at  TIMESTAMPTZ;

UPDATE bms_orders
   SET cancelled_at = COALESCE(cancelled_at, updated_at)
 WHERE cancelled_at IS NULL AND status = 'CANCELLED';

UPDATE bms_orders
   SET returned_at = COALESCE(returned_at, updated_at)
 WHERE returned_at IS NULL AND status = 'RETURNED';

ALTER TABLE bms_payments
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_at  TIMESTAMPTZ;

UPDATE bms_payments
   SET confirmed_at = COALESCE(
     confirmed_at,
     CASE WHEN status = 'CONFIRMED' THEN updated_at ELSE created_at END
   )
 WHERE confirmed_at IS NULL AND status IN ('CONFIRMED', 'REFUNDED');

UPDATE bms_payments
   SET rejected_at = COALESCE(rejected_at, updated_at)
 WHERE rejected_at IS NULL AND status = 'REJECTED';

UPDATE bms_payments
   SET refunded_at = COALESCE(refunded_at, updated_at)
 WHERE refunded_at IS NULL AND status = 'REFUNDED';

-- A refunded/returned legacy row may have an updated_at days after the sale.
-- Prefer its earliest payment evidence; created_at is the least misleading
-- fallback when the old schema did not retain the actual confirmation time.
UPDATE bms_orders o
   SET paid_at = COALESCE(
     o.paid_at,
     (
       SELECT MIN(COALESCE(p.confirmed_at, p.created_at))
         FROM bms_payments p
        WHERE p.tenant_id = o.tenant_id
          AND p.order_id = o.id
          AND p.status IN ('CONFIRMED','REFUNDED')
     ),
     o.created_at
   )
 WHERE o.paid_at IS NULL
   AND o.status IN ('PAID', 'PACKING', 'SHIPPED', 'COMPLETED', 'RETURNED');

CREATE INDEX IF NOT EXISTS idx_bms_orders_tenant_paid_at
  ON bms_orders (tenant_id, paid_at) WHERE paid_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bms_orders_tenant_cancelled_at
  ON bms_orders (tenant_id, cancelled_at) WHERE cancelled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bms_payments_tenant_refunded_at
  ON bms_payments (tenant_id, refunded_at) WHERE refunded_at IS NOT NULL;

-- upsertProduct() already rejects a negative cost, but old/import/direct SQL
-- paths had no database backstop. NOT VALID preserves any legacy bad row while
-- enforcing the rule for every new or changed row; operators can repair legacy
-- rows before a later migration validates the constraint globally.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_products'::regclass
       AND conname = 'bms_products_cost_price_nonnegative'
  ) THEN
    ALTER TABLE bms_products
      ADD CONSTRAINT bms_products_cost_price_nonnegative
      CHECK (cost_price IS NULL OR cost_price >= 0) NOT VALID;
  END IF;
END $$;
