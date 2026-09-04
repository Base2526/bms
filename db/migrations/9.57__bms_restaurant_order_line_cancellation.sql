-- 9.57 — Immutable restaurant line-cancellation cause and merchant-absorbed repricing.
-- Wrapped so a mid-file failure cannot leave half of these columns applied.
BEGIN;

-- 7.96 left TWO check constraints whose definition mentions "source":
--   CHECK (source IN ('TIER','COUPON','POINTS','MANUAL'))     <- the value list to widen
--   CHECK (points_used = 0 OR source = 'POINTS')              <- must survive untouched
-- Matching on LIKE '%source%' alone picks one of them at random. Dropping the wrong one
-- leaves the old 4-value list in place (so every MERCHANT_ABSORBED insert fails with a
-- check violation) and silently deletes the points_used guard. Narrow the match to a
-- single-column check on "source" whose definition carries the value list.
DO $$ DECLARE victim TEXT;
BEGIN
  FOR victim IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.conrelid = 'bms_order_discounts'::regclass
       AND c.contype = 'c'
       AND array_length(c.conkey, 1) = 1
       AND a.attname = 'source'
       AND pg_get_constraintdef(c.oid) LIKE '%TIER%'
  LOOP
    EXECUTE format('ALTER TABLE bms_order_discounts DROP CONSTRAINT %I', victim);
  END LOOP;
  ALTER TABLE bms_order_discounts ADD CONSTRAINT bms_order_discounts_source_check
    CHECK (source IN ('TIER','COUPON','POINTS','MANUAL','MERCHANT_ABSORBED'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE bms_pos_returns
  ADD COLUMN IF NOT EXISTS merchant_absorbed_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (merchant_absorbed_amount >= 0);

ALTER TABLE bms_pos_return_items
  ADD COLUMN IF NOT EXISTS cancellation_cause TEXT,
  ADD COLUMN IF NOT EXISTS cause_selected_by UUID REFERENCES users(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE bms_pos_return_items ADD CONSTRAINT bms_pos_return_items_cancellation_cause_check
    CHECK (cancellation_cause IS NULL OR cancellation_cause IN ('MERCHANT_OUT_OF_STOCK','CUSTOMER_CHANGED'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION bms_cancellation_cause_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cancellation_cause IS DISTINCT FROM NEW.cancellation_cause
     OR OLD.cause_selected_by IS DISTINCT FROM NEW.cause_selected_by THEN
    RAISE EXCEPTION 'restaurant line cancellation cause is immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_bms_cancellation_cause_immutable ON bms_pos_return_items;
CREATE TRIGGER trg_bms_cancellation_cause_immutable BEFORE UPDATE ON bms_pos_return_items
FOR EACH ROW EXECUTE FUNCTION bms_cancellation_cause_immutable();

ALTER TABLE bms_store_profile
  ADD COLUMN IF NOT EXISTS restaurant_merchant_absorb_limit NUMERIC(12,2) NOT NULL DEFAULT 2000
  CHECK (restaurant_merchant_absorb_limit >= 0);

INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, 'order.line.cancel'
FROM bms_tenants t CROSS JOIN roles r
WHERE r.name IN ('Manager','Cashier')
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;

COMMENT ON COLUMN bms_pos_return_items.cancellation_cause IS
  'Immutable per-line cause. Sold-out branch state forces MERCHANT_OUT_OF_STOCK server-side.';
COMMENT ON COLUMN bms_store_profile.restaurant_merchant_absorb_limit IS
  'Separate approval threshold for a repricing difference absorbed by the restaurant; not the refund threshold.';

COMMIT;
