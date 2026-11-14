-- Fish-dock location evidence and multi-delivery commitments. These are sidecars:
-- stock changes remain in the existing inventory/order/production services.
CREATE TABLE IF NOT EXISTS bms_fish_storage_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  lot_id UUID NOT NULL,
  location_id UUID NOT NULL,
  lot_qty_at_count INTEGER NOT NULL CHECK (lot_qty_at_count >= 0),
  lot_updated_at_count TIMESTAMPTZ NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  counted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  counted_by UUID NOT NULL REFERENCES users(id),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,lot_id),
  FOREIGN KEY (tenant_id,lot_id) REFERENCES bms_inventory_lots(tenant_id,id),
  FOREIGN KEY (tenant_id,location_id) REFERENCES bms_locations(tenant_id,id)
);

CREATE TABLE IF NOT EXISTS bms_fish_storage_count_lines (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  count_id UUID NOT NULL,
  zone TEXT NOT NULL CHECK (zone IN ('READY','COLD_ROOM','OTHER')),
  qty_grams INTEGER NOT NULL CHECK (qty_grams >= 0),
  UNIQUE (tenant_id,count_id,zone),
  FOREIGN KEY (tenant_id,count_id) REFERENCES bms_fish_storage_counts(tenant_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bms_fish_delivery_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  due_on DATE,
  note TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,request_key),
  FOREIGN KEY (tenant_id,location_id) REFERENCES bms_locations(tenant_id,id),
  FOREIGN KEY (tenant_id,customer_id) REFERENCES bms_customers(tenant_id,id)
);

CREATE TABLE IF NOT EXISTS bms_fish_delivery_plan_lines (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL,
  sku TEXT NOT NULL,
  size TEXT NOT NULL,
  agreed_grams INTEGER NOT NULL CHECK (agreed_grams > 0),
  UNIQUE (tenant_id,plan_id,sku,size),
  FOREIGN KEY (tenant_id,plan_id) REFERENCES bms_fish_delivery_plans(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,sku) REFERENCES bms_products(tenant_id,sku)
);

CREATE TABLE IF NOT EXISTS bms_fish_delivery_plan_orders (
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL,
  order_id UUID NOT NULL,
  linked_by UUID NOT NULL REFERENCES users(id),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,order_id),
  FOREIGN KEY (tenant_id,plan_id) REFERENCES bms_fish_delivery_plans(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,order_id) REFERENCES bms_orders(tenant_id,id)
);

CREATE INDEX IF NOT EXISTS bms_fish_delivery_customer_idx
  ON bms_fish_delivery_plans(tenant_id,customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS bms_fish_delivery_plan_order_idx
  ON bms_fish_delivery_plan_orders(tenant_id,plan_id);

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bms_fish_storage_counts','bms_fish_storage_count_lines',
    'bms_fish_delivery_plans','bms_fish_delivery_plan_lines','bms_fish_delivery_plan_orders'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS fish_owner_tenant_isolation ON %I',t);
    EXECUTE format(
      'CREATE POLICY fish_owner_tenant_isolation ON %I USING (tenant_id = NULLIF(current_setting(''bms.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''bms.tenant_id'', true), '''')::uuid)',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO bms_app',t);
  END LOOP;
END $$;
GRANT USAGE,SELECT ON SEQUENCE bms_fish_storage_count_lines_id_seq TO bms_app;
GRANT USAGE,SELECT ON SEQUENCE bms_fish_delivery_plan_lines_id_seq TO bms_app;

COMMENT ON TABLE bms_fish_storage_counts IS 'Human-verified physical zone snapshot. Stale when lot qty changes; never moves stock.';
COMMENT ON TABLE bms_fish_delivery_plans IS 'Agreed fish quantity across one or more ordinary BMS orders; ordinary orders alone move stock and money.';
-- ROLLBACK: disable fish owner routes first and retain these evidence rows.
-- Do not reverse order shipments or stock from a sidecar schema rollback.
