-- 10.129  Retail POS open-item sales and returns.
-- An open item is a sale-time description, never a catalog SKU or stock receipt.
-- ROLLBACK (only before any open-item sale exists): drop the two tables below and
-- remove the pos.open_item.sell role grants. Keep the sale rows once used.

CREATE TABLE IF NOT EXISTS bms_order_open_items (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL,
  label TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
  qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 9999),
  unit_amount NUMERIC(12,2) NOT NULL CHECK (unit_amount > 0),
  line_amount NUMERIC(12,2) NOT NULL CHECK (line_amount > 0),
  vat_category TEXT NOT NULL CHECK (vat_category IN ('V','N')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES bms_orders(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT bms_order_open_items_line_total
    CHECK (line_amount = qty * unit_amount)
);
CREATE INDEX IF NOT EXISTS idx_bms_order_open_items_order
  ON bms_order_open_items (tenant_id, order_id, id);
ALTER TABLE bms_order_open_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_order_open_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_order_open_items_tenant_isolation ON bms_order_open_items;
CREATE POLICY bms_order_open_items_tenant_isolation ON bms_order_open_items
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_order_open_items TO bms_app;
GRANT USAGE, SELECT ON SEQUENCE bms_order_open_items_id_seq TO bms_app;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_pos_returns_tenant_id_id
  ON bms_pos_returns (tenant_id, id);

CREATE TABLE IF NOT EXISTS bms_pos_return_open_items (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  pos_return_id UUID NOT NULL,
  order_open_item_id BIGINT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  refund_amount NUMERIC(12,2) NOT NULL CHECK (refund_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pos_return_id, order_open_item_id),
  FOREIGN KEY (tenant_id, pos_return_id)
    REFERENCES bms_pos_returns(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, order_open_item_id)
    REFERENCES bms_order_open_items(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_bms_pos_return_open_items_item
  ON bms_pos_return_open_items (tenant_id, order_open_item_id);
ALTER TABLE bms_pos_return_open_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_pos_return_open_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_pos_return_open_items_tenant_isolation ON bms_pos_return_open_items;
CREATE POLICY bms_pos_return_open_items_tenant_isolation ON bms_pos_return_open_items
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_pos_return_open_items TO bms_app;
GRANT USAGE, SELECT ON SEQUENCE bms_pos_return_open_items_id_seq TO bms_app;

INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, 'pos.open_item.sell'
  FROM bms_tenants t CROSS JOIN roles r WHERE r.name = 'Manager'
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
