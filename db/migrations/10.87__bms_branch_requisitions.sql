-- Branch requests are planning documents. No stock or movement triggers are added.
BEGIN;
CREATE TABLE IF NOT EXISTS bms_branch_requisitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id),
  request_no TEXT NOT NULL,
  location_id UUID NOT NULL REFERENCES bms_locations(id),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','CLOSED','CANCELLED')),
  needed_on DATE,
  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL','URGENT')),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note)<=2000),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>0),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id), UNIQUE (tenant_id,request_no)
);
CREATE TABLE IF NOT EXISTS bms_branch_requisition_items (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id),
  requisition_id UUID NOT NULL,
  product_sku TEXT NOT NULL,
  size TEXT NOT NULL,
  product_name TEXT NOT NULL,
  requested_qty INTEGER NOT NULL CHECK (requested_qty>0),
  approved_qty INTEGER CHECK (approved_qty>=0 AND approved_qty<=requested_qty),
  review_note TEXT NOT NULL DEFAULT '' CHECK (length(review_note)<=2000),
  UNIQUE (tenant_id,id), UNIQUE (requisition_id,product_sku,size),
  FOREIGN KEY (tenant_id,requisition_id) REFERENCES bms_branch_requisitions(tenant_id,id),
  FOREIGN KEY (tenant_id,product_sku) REFERENCES bms_products(tenant_id,sku)
);
-- Each transfer item belongs to one request line: its receipt cannot be counted twice.
CREATE UNIQUE INDEX IF NOT EXISTS bms_transfer_items_tenant_identity ON bms_stock_transfer_items(tenant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS bms_purchase_items_tenant_identity ON bms_purchase_order_items(tenant_id,id);
CREATE TABLE IF NOT EXISTS bms_branch_requisition_transfers (
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id),
  item_id BIGINT NOT NULL,
  transfer_item_id BIGINT NOT NULL REFERENCES bms_stock_transfer_items(id),
  PRIMARY KEY (tenant_id,transfer_item_id),
  FOREIGN KEY (tenant_id,item_id) REFERENCES bms_branch_requisition_items(tenant_id,id)
);
-- Supplier fulfilment is evidence of purchasing only, never branch receipt evidence.
CREATE TABLE IF NOT EXISTS bms_branch_requisition_purchases (
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id),
  item_id BIGINT NOT NULL,
  po_item_id BIGINT NOT NULL REFERENCES bms_purchase_order_items(id),
  qty INTEGER NOT NULL CHECK (qty>0),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,item_id,po_item_id),
  FOREIGN KEY (tenant_id,item_id) REFERENCES bms_branch_requisition_items(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS bms_branch_requisition_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id),
  requisition_id UUID NOT NULL,
  action TEXT NOT NULL,
  actor_id UUID NOT NULL REFERENCES users(id),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,requisition_id) REFERENCES bms_branch_requisitions(tenant_id,id)
);
ALTER TABLE bms_branch_requisition_transfers DROP CONSTRAINT IF EXISTS requisition_transfer_tenant_fk;
ALTER TABLE bms_branch_requisitions DROP CONSTRAINT IF EXISTS requisition_location_tenant_fk;
ALTER TABLE bms_branch_requisitions ADD CONSTRAINT requisition_location_tenant_fk
  FOREIGN KEY (tenant_id,location_id) REFERENCES bms_locations(tenant_id,id);
ALTER TABLE bms_branch_requisition_transfers ADD CONSTRAINT requisition_transfer_tenant_fk
  FOREIGN KEY (tenant_id,transfer_item_id) REFERENCES bms_stock_transfer_items(tenant_id,id);
ALTER TABLE bms_branch_requisition_purchases DROP CONSTRAINT IF EXISTS requisition_purchase_tenant_fk;
ALTER TABLE bms_branch_requisition_purchases ADD CONSTRAINT requisition_purchase_tenant_fk
  FOREIGN KEY (tenant_id,po_item_id) REFERENCES bms_purchase_order_items(tenant_id,id);
CREATE INDEX IF NOT EXISTS bms_requisitions_queue ON bms_branch_requisitions(tenant_id,location_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS bms_requisitions_items_parent ON bms_branch_requisition_items(tenant_id,requisition_id);
CREATE INDEX IF NOT EXISTS bms_requisitions_transfers_item ON bms_branch_requisition_transfers(tenant_id,item_id);
CREATE INDEX IF NOT EXISTS bms_requisitions_purchases_po ON bms_branch_requisition_purchases(tenant_id,po_item_id);
CREATE INDEX IF NOT EXISTS bms_requisitions_events_parent ON bms_branch_requisition_events(tenant_id,requisition_id,id DESC);
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['bms_branch_requisitions','bms_branch_requisition_items',
    'bms_branch_requisition_transfers','bms_branch_requisition_purchases','bms_branch_requisition_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''bms.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''bms.tenant_id'',true),'''')::uuid)',t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO bms_app',t);
  END LOOP;
END $$;
GRANT UPDATE ON bms_branch_requisitions,bms_branch_requisition_items TO bms_app;
GRANT UPDATE(qty) ON bms_branch_requisition_purchases TO bms_app;
GRANT DELETE ON bms_branch_requisition_items TO bms_app;
GRANT USAGE,SELECT ON SEQUENCE bms_branch_requisition_items_id_seq,bms_branch_requisition_events_id_seq TO bms_app;
INSERT INTO bms_role_permissions(tenant_id,role_id,permission)
SELECT t.id,r.id,p.permission FROM bms_tenants t CROSS JOIN roles r
JOIN (VALUES ('Manager','inventory.requisition.view'),('Manager','inventory.requisition.create'),
 ('Manager','inventory.requisition.review'),('Warehouse','inventory.requisition.view'),
 ('Warehouse','inventory.requisition.create')) p(role_name,permission) ON p.role_name=r.name
ON CONFLICT DO NOTHING;
COMMIT;
-- ROLLBACK: disable the requisition UI first. Preserve request/decision history; no existing
-- PO/transfer/stock behaviour was changed (only tenant identity indexes were added to old item
-- tables). Do not drop business evidence.
