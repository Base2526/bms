-- 9.56 — Restaurant online order handoff: explicit branch/fulfillment and human acceptance.
-- Wrapped so a mid-file failure cannot leave half of these columns applied.
BEGIN;

ALTER TABLE bms_orders
  ADD COLUMN IF NOT EXISTS fulfillment_type TEXT,
  ADD COLUMN IF NOT EXISTS promised_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE bms_orders ADD CONSTRAINT bms_orders_fulfillment_type_chk
    CHECK (fulfillment_type IS NULL OR fulfillment_type IN ('DELIVERY', 'PICKUP'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE bms_store_profile
  ADD COLUMN IF NOT EXISTS restaurant_order_hours JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS restaurant_orders_paused BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS restaurant_orders_paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS restaurant_orders_paused_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bms_orders_restaurant_incoming
  ON bms_orders (tenant_id, location_id, promised_at NULLS LAST, created_at)
  WHERE fulfillment_type IS NOT NULL AND status IN ('PAID', 'PACKING');

COMMENT ON COLUMN bms_orders.fulfillment_type IS
  'DELIVERY or PICKUP for online restaurant orders; NULL preserves non-restaurant orders.';
COMMENT ON COLUMN bms_orders.promised_at IS
  'Customer-facing promised fulfillment time, used for kitchen/incoming-order ordering.';
COMMENT ON COLUMN bms_store_profile.restaurant_order_hours IS
  'Structured weekly intervals: [{day:0..6,open:"HH:mm",close:"HH:mm"}]. Empty keeps legacy always-open behavior.';

COMMIT;
