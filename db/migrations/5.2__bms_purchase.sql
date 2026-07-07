-- =============================================================
-- 5.2  BMS Purchase Management — suppliers + purchase orders (PO)
-- -------------------------------------------------------------
-- ตาม CLAUDE.md §8 + TOOLS.md: createPurchaseOrder / receivePurchaseOrder /
-- cancelPurchaseOrder + Supplier History
--
-- flow:  OPEN → PARTIAL → RECEIVED           (รับของครบ)
--             └→ CANCELLED                    (ก่อนรับครบ)
--
-- สต็อกจะ "เข้า" ก็ต่อเมื่อ receive เท่านั้น (ตอนสร้าง PO ไม่ขยับสต็อก)
-- ทุกครั้งที่รับของ → บันทึก bms_stock_movements type = STOCK_IN
-- multi-tenant + RLS เหมือนตาราง BMS อื่น (idempotent — รันซ้ำได้)
-- =============================================================

-- ---- suppliers (ผู้ขาย) ----
CREATE TABLE IF NOT EXISTS bms_suppliers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- ---- purchase orders ----
CREATE TABLE IF NOT EXISTS bms_purchase_orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  supplier_id   UUID REFERENCES bms_suppliers(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'OPEN'
                  CHECK (status IN ('OPEN','PARTIAL','RECEIVED','CANCELLED')),
  total_amount  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),  -- มูลค่าที่สั่ง (qty_ordered × unit_cost)
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bms_purchase_order_items (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  po_id         UUID NOT NULL REFERENCES bms_purchase_orders(id) ON DELETE CASCADE,
  product_sku   TEXT NOT NULL,
  size          TEXT NOT NULL,
  qty_ordered   INTEGER NOT NULL CHECK (qty_ordered > 0),
  qty_received  INTEGER NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  unit_cost     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),  -- ทุนต่อหน่วย (snapshot)
  CHECK (qty_received <= qty_ordered),
  -- อ้าง product ระดับร้าน (size ยังไม่ต้องมีใน inventory — receive จะสร้างให้)
  FOREIGN KEY (tenant_id, product_sku) REFERENCES bms_products(tenant_id, sku),
  UNIQUE (po_id, product_sku, size)
);

CREATE INDEX IF NOT EXISTS idx_bms_po_tenant       ON bms_purchase_orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_bms_po_supplier     ON bms_purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_bms_po_items_po     ON bms_purchase_order_items(po_id);
CREATE INDEX IF NOT EXISTS idx_bms_suppliers_tenant ON bms_suppliers(tenant_id);

-- ---- Row-Level Security (เหมือน 4.2) ----
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['bms_suppliers','bms_purchase_orders','bms_purchase_order_items']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t||'_tenant_isolation', t);
    EXECUTE format($p$
      CREATE POLICY %I ON %I
        USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
        WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
    $p$, t||'_tenant_isolation', t);
  END LOOP;
END $$;

-- ---- grant ให้ RLS role (เหมือน 4.3) ----
GRANT SELECT, INSERT, UPDATE, DELETE ON
  bms_suppliers, bms_purchase_orders, bms_purchase_order_items
  TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
