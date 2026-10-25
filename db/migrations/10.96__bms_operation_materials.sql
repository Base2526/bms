BEGIN;
-- Planning only; purchase.ts remains stock/lot/value authority. No stock/realtime triggers.
CREATE TABLE IF NOT EXISTS bms_operation_material_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES bms_tenants(id),location_id uuid NOT NULL,
 title text NOT NULL,from_date date NOT NULL,to_date date NOT NULL,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CONFIRMED','CLOSED','CANCELLED')),
 version int NOT NULL DEFAULT 1,run_id uuid NOT NULL,snapshot jsonb NOT NULL,fingerprint text NOT NULL,
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),followup_at timestamptz NOT NULL DEFAULT '-infinity',
 UNIQUE(tenant_id,id),CHECK(to_date>=from_date AND to_date-from_date<=6),
 FOREIGN KEY(tenant_id,location_id) REFERENCES bms_locations(tenant_id,id),
 FOREIGN KEY(tenant_id,run_id) REFERENCES bms_operation_runs(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS bms_operation_material_sources (
 tenant_id uuid NOT NULL,plan_id uuid NOT NULL,production_id uuid NOT NULL,priority int NOT NULL CHECK(priority BETWEEN 1 AND 3),active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(tenant_id,plan_id,production_id),
 FOREIGN KEY(tenant_id,plan_id) REFERENCES bms_operation_material_plans(tenant_id,id),
 FOREIGN KEY(tenant_id,production_id) REFERENCES bms_operation_production(tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS bms_material_source_active ON bms_operation_material_sources(tenant_id,production_id) WHERE active;
CREATE TABLE IF NOT EXISTS bms_operation_material_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,plan_id uuid NOT NULL,
 product_sku text NOT NULL,size text NOT NULL,base_unit text NOT NULL,qty int NOT NULL CHECK(qty>0),
 po_id uuid,po_item_id bigint,requisition_item_id bigint,needed_at timestamptz NOT NULL,
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),CHECK((po_item_id IS NOT NULL AND po_id IS NOT NULL AND requisition_item_id IS NULL) OR (po_item_id IS NULL AND po_id IS NULL AND requisition_item_id IS NOT NULL)),
 FOREIGN KEY(tenant_id,plan_id) REFERENCES bms_operation_material_plans(tenant_id,id),
 FOREIGN KEY(tenant_id,po_item_id) REFERENCES bms_purchase_order_items(tenant_id,id),
 FOREIGN KEY(tenant_id,requisition_item_id) REFERENCES bms_branch_requisition_items(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS bms_material_link_po ON bms_operation_material_links(tenant_id,po_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS bms_material_link_request ON bms_operation_material_links(tenant_id,requisition_item_id) WHERE requisition_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bms_material_link_plan ON bms_operation_material_links(tenant_id,plan_id);
CREATE TABLE IF NOT EXISTS bms_operation_material_inspections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,link_id uuid NOT NULL,run_id uuid NOT NULL,
 accepted_qty int NOT NULL CHECK(accepted_qty>=0),rejected_qty int NOT NULL CHECK(rejected_qty>=0),
 lot_no text,expiry_date date,note text NOT NULL,version int NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','POSTED','REJECTED','CANCELLED')),
 evidence jsonb,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),posted_at timestamptz,
 CHECK(accepted_qty+rejected_qty>0),UNIQUE(tenant_id,id),UNIQUE(tenant_id,run_id),
 FOREIGN KEY(tenant_id,link_id) REFERENCES bms_operation_material_links(tenant_id,id),
 FOREIGN KEY(tenant_id,run_id) REFERENCES bms_operation_runs(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS bms_purchase_receipt_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES bms_tenants(id),receipt_id uuid NOT NULL,
 po_id uuid NOT NULL,po_item_id bigint NOT NULL,location_id uuid NOT NULL,
 product_sku text NOT NULL,size text NOT NULL,qty int NOT NULL CHECK(qty>0),lot_id uuid,lot_no text,expiry_date date,
 movement_id bigint NOT NULL,actor text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,movement_id),FOREIGN KEY(tenant_id,location_id) REFERENCES bms_locations(tenant_id,id),
 FOREIGN KEY(tenant_id,po_item_id) REFERENCES bms_purchase_order_items(tenant_id,id),
 FOREIGN KEY(tenant_id,receipt_id) REFERENCES bms_operation_material_inspections(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS bms_purchase_receipt_group ON bms_purchase_receipt_evidence(tenant_id,receipt_id);
CREATE TABLE IF NOT EXISTS bms_operation_material_events (
 id bigserial PRIMARY KEY,tenant_id uuid NOT NULL,plan_id uuid NOT NULL,action text NOT NULL,actor text NOT NULL,note text NOT NULL,details jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,plan_id) REFERENCES bms_operation_material_plans(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS bms_material_events_plan ON bms_operation_material_events(tenant_id,plan_id,id DESC);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['bms_operation_material_plans','bms_operation_material_sources','bms_operation_material_links','bms_operation_material_inspections','bms_purchase_receipt_evidence','bms_operation_material_events'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(tenant_id=nullif(current_setting(''bms.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''bms.tenant_id'',true),'''')::uuid)',t);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO bms_app',t);
  EXECUTE format('REVOKE UPDATE,DELETE ON %I FROM bms_app',t);
 END LOOP;
END $$;
GRANT UPDATE(status,version,snapshot,fingerprint,followup_at) ON bms_operation_material_plans TO bms_app;
GRANT UPDATE(active) ON bms_operation_material_sources TO bms_app;
GRANT UPDATE(status,version,evidence,posted_at) ON bms_operation_material_inspections TO bms_app;
GRANT USAGE,SELECT ON SEQUENCE bms_operation_material_events_id_seq TO bms_app;
INSERT INTO bms_role_permissions(tenant_id,role_id,permission)
SELECT t.id,r.id,p.permission FROM bms_tenants t CROSS JOIN roles r CROSS JOIN (VALUES('operations.material.view'),('operations.material.manage'),('operations.material.review')) p(permission) WHERE r.name='Manager' ON CONFLICT DO NOTHING;
COMMIT;
-- ROLLBACK: disable material commands before app rollback; preserve plans, receipts and movements.
-- Requires 10.87/10.88 and 10.90-10.95. Historical receipts are not reconstructed.
