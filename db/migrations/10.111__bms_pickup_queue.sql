-- =============================================================
-- 10.111 — Pickup queue numbers for counter/takeaway sales
-- -------------------------------------------------------------
-- A cafe or food stall hands the customer a number at the counter, then calls it on a screen
-- when the order is ready. BMS already numbers people waiting for a TABLE (`9.64`); this is
-- the separate "waiting for an ORDER" number.
--
-- Deliberate boundaries:
--   * A queue row is a label attached to a POS sale that has already committed. It is issued
--     in its own transaction AFTER the sale, never inside `createOrderInTx()`, so a queue
--     failure can never block taking money or leave a half-written bill.
--   * One number per order (UNIQUE tenant_id, order_id): a replayed sale request gets the
--     same number instead of a second one.
--   * Numbers are per branch per service day, using the same shop-timezone service day as the
--     table waitlist, so a shop open past midnight keeps counting.
--   * The row holds no customer name, phone or bill amount. The public call screen shows only
--     the number and its status.
--   * READY may come from the kitchen (every live kitchen ticket of the order is READY/SERVED)
--     or from staff pressing "call". `ready_source` records which, so a kitchen undo only
--     reverts what the kitchen itself set.
-- =============================================================

-- Branch policy is authoritative for every till in the branch. The existing per-device switch
-- remains an opt-in override, but a manager can enable numbering once here instead of visiting
-- every register. Auto-hide affects the customer board only; staff history is never deleted.
ALTER TABLE bms_locations
  ADD COLUMN IF NOT EXISTS pickup_queue_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pickup_queue_auto_hide_minutes INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS pickup_queue_show_preparing BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS pickup_queue_board_message TEXT;

DO $$ BEGIN
  ALTER TABLE bms_locations ADD CONSTRAINT bms_locations_pickup_queue_auto_hide_check
    CHECK (pickup_queue_auto_hide_minutes BETWEEN 0 AND 1440);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE bms_locations ADD CONSTRAINT bms_locations_pickup_queue_board_message_check
    CHECK (pickup_queue_board_message IS NULL OR char_length(pickup_queue_board_message) <= 120);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN bms_locations.pickup_queue_enabled IS
  'Issue pickup numbers for every eligible online POS sale in this branch; per-device opt-in may also request one.';
COMMENT ON COLUMN bms_locations.pickup_queue_auto_hide_minutes IS
  'Hide READY numbers from the customer board after this many minutes; 0 keeps them until staff closes the row.';
COMMENT ON COLUMN bms_locations.pickup_queue_show_preparing IS
  'Whether the customer board shows PREPARING numbers; staff views always keep them.';
COMMENT ON COLUMN bms_locations.pickup_queue_board_message IS
  'Optional branch message shown on the customer pickup board; no customer/order data.';

CREATE TABLE IF NOT EXISTS bms_pickup_queue (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id    UUID NOT NULL,
  order_id       UUID NOT NULL,
  pos_device_id  UUID,
  service_date   DATE NOT NULL,
  queue_no       INTEGER NOT NULL CHECK (queue_no BETWEEN 1 AND 9999),
  status         TEXT NOT NULL DEFAULT 'PREPARING' CHECK (status IN (
    'PREPARING', 'READY', 'COLLECTED', 'CANCELLED'
  )),
  ready_source   TEXT CHECK (ready_source IS NULL OR ready_source IN ('KITCHEN', 'STAFF')),
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  ready_at       TIMESTAMPTZ,
  -- Bumped on every (re)call so the screen can highlight and chime again.
  called_at      TIMESTAMPTZ,
  closed_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, order_id),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, order_id)
    REFERENCES bms_orders(tenant_id, id) ON DELETE CASCADE,
  -- Open rows: READY exactly when it carries a time and a source (PREPARING carries neither).
  -- Closed rows keep whatever readiness they had, as history.
  CONSTRAINT bms_pickup_queue_ready_shape CHECK (
    status IN ('COLLECTED', 'CANCELLED')
    OR ((status = 'READY') = (ready_at IS NOT NULL AND ready_source IS NOT NULL))
  ),
  CONSTRAINT bms_pickup_queue_closed_shape CHECK (
    (status IN ('COLLECTED', 'CANCELLED')) = (closed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_pickup_queue_number
  ON bms_pickup_queue (tenant_id, location_id, service_date, queue_no);

CREATE INDEX IF NOT EXISTS idx_bms_pickup_queue_open
  ON bms_pickup_queue (tenant_id, location_id, status, created_at)
  WHERE status IN ('PREPARING', 'READY');

ALTER TABLE bms_pickup_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_pickup_queue FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_pickup_queue_tenant_isolation ON bms_pickup_queue;
CREATE POLICY bms_pickup_queue_tenant_isolation ON bms_pickup_queue
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_pickup_queue TO bms_app;

SELECT public.create_revision_trigger('bms_pickup_queue');

COMMENT ON TABLE bms_pickup_queue IS
  'Pickup numbers for counter/takeaway POS sales, issued after the sale commits and called on the '
  'branch queue screen. Holds no customer identity; one number per order per branch service day.';
COMMENT ON COLUMN bms_pickup_queue.ready_source IS
  'KITCHEN when every live kitchen ticket of the order reached READY/SERVED, STAFF when a cashier '
  'called it. A kitchen undo reverts only KITCHEN-sourced readiness.';
