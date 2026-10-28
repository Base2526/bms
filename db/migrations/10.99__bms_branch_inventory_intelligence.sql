BEGIN;

-- Branch-specific overrides are additive. The original 9.12 table remains the
-- tenant-wide default so existing shops keep their current policy.
CREATE TABLE IF NOT EXISTS bms_inventory_location_policies (
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL,
  product_sku TEXT NOT NULL,
  size TEXT NOT NULL,
  safety_stock_days INTEGER NOT NULL CHECK (safety_stock_days BETWEEN 0 AND 90),
  lead_time_days INTEGER NOT NULL CHECK (lead_time_days BETWEEN 0 AND 180),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, location_id, product_sku, size),
  FOREIGN KEY (tenant_id, location_id) REFERENCES bms_locations(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, product_sku) REFERENCES bms_products(tenant_id, sku) ON DELETE CASCADE
);

-- NULL deliberately means that the observed demand has not been attributed to
-- a branch. Intelligence readers report it separately and never duplicate it
-- into every branch recommendation.
ALTER TABLE bms_inventory_demand_events
  ADD COLUMN IF NOT EXISTS location_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_inventory_demand_events'::regclass
       AND conname = 'bms_inventory_demand_events_location_fk'
  ) THEN
    ALTER TABLE bms_inventory_demand_events
      ADD CONSTRAINT bms_inventory_demand_events_location_fk
      FOREIGN KEY (tenant_id, location_id)
      REFERENCES bms_locations(tenant_id, id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bms_inventory_location_policies_variant
  ON bms_inventory_location_policies (tenant_id, product_sku, size, location_id);
CREATE INDEX IF NOT EXISTS idx_bms_demand_events_location_variant
  ON bms_inventory_demand_events
    (tenant_id, location_id, product_sku, size, occurred_at DESC);

-- Forecast snapshots let a later evaluation compare the recommendation with
-- real stock consumption. They are evidence only and never move inventory.
CREATE TABLE IF NOT EXISTS bms_inventory_forecast_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  method_version TEXT NOT NULL,
  window_days INTEGER NOT NULL CHECK (window_days BETWEEN 1 AND 365),
  horizon_days INTEGER NOT NULL CHECK (horizon_days BETWEEN 1 AND 365),
  data_quality JSONB NOT NULL,
  evidence_digest TEXT NOT NULL,
  snapshot_date DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Bangkok')::date),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, method_version, window_days, horizon_days, snapshot_date)
);

CREATE TABLE IF NOT EXISTS bms_inventory_forecast_items (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  run_id UUID NOT NULL,
  location_id UUID NOT NULL,
  product_sku TEXT NOT NULL,
  size TEXT NOT NULL,
  target_date DATE NOT NULL,
  predicted_qty NUMERIC(14,3) NOT NULL CHECK (predicted_qty >= 0),
  lower_bound NUMERIC(14,3) CHECK (lower_bound IS NULL OR lower_bound >= 0),
  upper_bound NUMERIC(14,3) CHECK (upper_bound IS NULL OR upper_bound >= 0),
  actual_qty NUMERIC(14,3) CHECK (actual_qty IS NULL OR actual_qty >= 0),
  evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, run_id) REFERENCES bms_inventory_forecast_runs(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, location_id) REFERENCES bms_locations(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, product_sku) REFERENCES bms_products(tenant_id, sku) ON DELETE CASCADE,
  UNIQUE (tenant_id, run_id, location_id, product_sku, size, target_date)
);

CREATE INDEX IF NOT EXISTS idx_bms_inventory_forecast_runs_generated
  ON bms_inventory_forecast_runs (tenant_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bms_inventory_forecast_items_target
  ON bms_inventory_forecast_items
    (tenant_id, location_id, product_sku, size, target_date);

CREATE TABLE IF NOT EXISTS bms_purchase_order_idempotency (
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 8 AND 200),
  request_hash TEXT NOT NULL,
  po_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, request_id),
  FOREIGN KEY (tenant_id, po_id) REFERENCES bms_purchase_orders(tenant_id, id) ON DELETE CASCADE
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bms_inventory_location_policies',
    'bms_inventory_forecast_runs',
    'bms_inventory_forecast_items',
    'bms_purchase_order_idempotency'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''bms.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''bms.tenant_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON bms_inventory_location_policies TO bms_app;
GRANT SELECT, INSERT ON bms_inventory_forecast_runs, bms_inventory_forecast_items TO bms_app;
GRANT UPDATE(actual_qty, evaluated_at) ON bms_inventory_forecast_items TO bms_app;
GRANT SELECT, INSERT ON bms_purchase_order_idempotency TO bms_app;
GRANT UPDATE(po_id) ON bms_purchase_order_idempotency TO bms_app;
GRANT USAGE, SELECT ON SEQUENCE bms_inventory_forecast_items_id_seq TO bms_app;

COMMIT;

-- ROLLBACK (manual, after stopping intelligence writers): drop forecast item/run
-- tables, drop the location policy table, then drop the demand-event location FK
-- and column. No stock, movement, order, PO or action rows are changed by 10.99.
