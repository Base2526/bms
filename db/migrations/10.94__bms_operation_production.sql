BEGIN;
-- One output per batch. Existing recipes remain virtual BOMs; a separate DIRECT output SKU is explicit.
CREATE TABLE IF NOT EXISTS bms_operation_production (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
 location_id uuid NOT NULL, run_id uuid NOT NULL, recipe_id uuid NOT NULL,
 output_sku text NOT NULL, output_size text NOT NULL, planned_qty int NOT NULL CHECK(planned_qty>0),
 snapshot jsonb NOT NULL, status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','READY','POSTED','CANCELLED')),
 version int NOT NULL DEFAULT 1, actual_qty int CHECK(actual_qty>0), output_lot_id uuid,
 produced_on date, expiry_date date, note text NOT NULL DEFAULT '', created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,run_id),
 FOREIGN KEY(tenant_id,location_id) REFERENCES bms_locations(tenant_id,id),
 FOREIGN KEY(tenant_id,run_id) REFERENCES bms_operation_runs(tenant_id,id),
 CHECK(expiry_date IS NULL OR expiry_date>=produced_on)
);
CREATE INDEX IF NOT EXISTS bms_operation_production_branch ON bms_operation_production(tenant_id,location_id,created_at DESC,id);
ALTER TABLE bms_operation_production ADD COLUMN IF NOT EXISTS followup_at timestamptz NOT NULL DEFAULT '-infinity';
CREATE TABLE IF NOT EXISTS bms_operation_production_inputs (
 tenant_id uuid NOT NULL, production_id uuid NOT NULL, product_sku text NOT NULL, size text NOT NULL,
 qty int NOT NULL CHECK(qty>0), lots jsonb NOT NULL, movement_id bigint NOT NULL,
 PRIMARY KEY(tenant_id,production_id,product_sku,size), UNIQUE(tenant_id,movement_id),
 FOREIGN KEY(tenant_id,production_id) REFERENCES bms_operation_production(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS bms_operation_production_events (
 id bigserial PRIMARY KEY,tenant_id uuid NOT NULL,production_id uuid NOT NULL,action text NOT NULL,
 actor text NOT NULL,note text NOT NULL,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,production_id) REFERENCES bms_operation_production(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS bms_operation_production_waste (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,production_id uuid NOT NULL,
 wastage_id uuid NOT NULL,lot_id uuid NOT NULL,qty int NOT NULL CHECK(qty>0),reason text NOT NULL,
 action_id uuid,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,production_id) REFERENCES bms_operation_production(tenant_id,id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['bms_operation_production','bms_operation_production_inputs','bms_operation_production_events','bms_operation_production_waste'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(tenant_id=nullif(current_setting(''bms.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''bms.tenant_id'',true),'''')::uuid)',t);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO bms_app',t);
  EXECUTE format('REVOKE UPDATE,DELETE ON %I FROM bms_app',t);
 END LOOP;
END $$;
GRANT UPDATE(status,version,actual_qty,output_lot_id,produced_on,expiry_date,note,posted_at,followup_at) ON bms_operation_production TO bms_app;
GRANT USAGE,SELECT ON SEQUENCE bms_operation_production_events_id_seq TO bms_app;
ALTER TABLE bms_stock_movements DROP CONSTRAINT IF EXISTS bms_stock_movements_type_check;
ALTER TABLE bms_stock_movements ADD CONSTRAINT bms_stock_movements_type_check CHECK(type IN
 ('STOCK_IN','STOCK_OUT','RESERVE','RELEASE','SHIP','RETURN','TRANSFER_IN','TRANSFER_OUT','COUNT_ADJUST','QUARANTINE_IN','TRANSFER_LOST','WASTAGE','PRODUCTION_IN','PRODUCTION_OUT'));
INSERT INTO bms_role_permissions(tenant_id,role_id,permission)
SELECT t.id,r.id,p.permission FROM bms_tenants t CROSS JOIN roles r
JOIN (VALUES ('Manager','operations.production.manage'),('Manager','operations.production.post'),('Warehouse','operations.production.manage'))p(role_name,permission) ON p.role_name=r.name ON CONFLICT DO NOTHING;
COMMIT;
-- ROLLBACK: disable production commands before reverting app. Retain all evidence and new movement kinds.
-- No stock reconstruction, destructive down migration or new realtime trigger.
