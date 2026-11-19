BEGIN;
-- A demand is a reviewed production request. It is not an order, quote or reservation.
CREATE TABLE IF NOT EXISTS bms_factory_demands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
  location_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  output_sku text NOT NULL,
  output_size text NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  due_at timestamptz NOT NULL,
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ORDERED','CANCELLED')),
  version integer NOT NULL DEFAULT 1,
  order_id uuid,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, location_id) REFERENCES bms_locations(tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES bms_customers(tenant_id, id),
  FOREIGN KEY (tenant_id, output_sku, output_size)
    REFERENCES bms_product_variants(tenant_id, product_sku, code),
  FOREIGN KEY (tenant_id, order_id) REFERENCES bms_orders(tenant_id, id),
  CHECK ((status='ORDERED') = (order_id IS NOT NULL))
);
ALTER TABLE bms_factory_demands ALTER COLUMN customer_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS bms_factory_demands_workspace
  ON bms_factory_demands(tenant_id, location_id, status, due_at, id);
ALTER TABLE bms_factory_demands ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_factory_demands FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms_factory_demands;
CREATE POLICY tenant_isolation ON bms_factory_demands
  USING (tenant_id=nullif(current_setting('bms.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=nullif(current_setting('bms.tenant_id',true),'')::uuid);
GRANT SELECT, INSERT ON bms_factory_demands TO bms_app;
GRANT UPDATE(status,version,order_id,updated_at) ON bms_factory_demands TO bms_app;
ALTER TABLE bms_operation_production ADD COLUMN IF NOT EXISTS factory_demand_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='bms_operation_production'::regclass AND conname='bms_operation_production_factory_demand_fk') THEN
    ALTER TABLE bms_operation_production ADD CONSTRAINT bms_operation_production_factory_demand_fk
      FOREIGN KEY (tenant_id, factory_demand_id) REFERENCES bms_factory_demands(tenant_id, id);
  END IF;
END $$;
COMMIT;
-- ROLLBACK: stop new factory demand commands; retain demands, linked batches and
-- orders. Never delete or backfill stock/reservation from a demand record.
