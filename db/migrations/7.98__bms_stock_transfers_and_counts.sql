-- =============================================================
-- 7.98 — โอนย้ายสต็อกระหว่างสาขา + นับสต็อก (stock take)
-- -------------------------------------------------------------
-- 7.84 เพิ่ม bms_locations และ bms_inventory.location_id ไว้แล้ว แต่ไม่มีทาง
-- ย้ายของระหว่างสาขา และไม่มีทางแก้ยอดให้ตรงกับของจริงบนชั้น เปิดสองสาขาแล้ว
-- ตัวเลขจะเพี้ยนขึ้นเรื่อย ๆ โดยไม่มีเครื่องมือดึงกลับ
-- =============================================================

-- ---- 1. ประเภท movement ใหม่ ----------------------------------------
-- ต้องแยก TRANSFER_OUT/TRANSFER_IN ออกจาก STOCK_OUT/STOCK_IN เพราะการโอนย้าย
-- ไม่ได้ทำให้ของหายจากบริษัท — รายงานมูลค่าสต็อกรวมต้องไม่นับเป็นของออก
-- COUNT_ADJUST แยกอีกตัวเพราะเป็น "ของที่หายไปแล้วเพิ่งรู้" ซึ่งเป็นตัวเลขที่
-- ฝ่ายบัญชีต้องเห็นแยกจากการรับเข้า/ตัดขายตามปกติ
ALTER TABLE bms_stock_movements DROP CONSTRAINT IF EXISTS bms_stock_movements_type_check;
ALTER TABLE bms_stock_movements ADD CONSTRAINT bms_stock_movements_type_check
  CHECK (type IN ('STOCK_IN','STOCK_OUT','RESERVE','RELEASE','SHIP','RETURN',
                  'TRANSFER_IN','TRANSFER_OUT','COUNT_ADJUST'));

-- ---- 2. โอนย้ายระหว่างสาขา -------------------------------------------
-- สองขั้นโดยตั้งใจ: ส่ง (ของออกจากต้นทาง) แล้วค่อยรับ (ของเข้าปลายทาง)
-- ขั้นเดียวจบแปลว่าของโผล่ที่ปลายทางทันทีที่กดส่ง ซึ่งไม่จริง — ของอยู่บนรถ
-- ระหว่างนั้นจริง ๆ และถ้าหายระหว่างทางจะไม่มีใครรู้ว่าหายตอนไหน
--
-- ของที่ยัง IN_TRANSIT ไม่ได้อยู่ในสต็อกของสาขาไหนเลย ซึ่งถูกต้อง: นับสต็อก
-- ที่สาขาต้นทางตอนนั้นต้องไม่เจอของกล่องนี้บนชั้น
CREATE TABLE IF NOT EXISTS bms_stock_transfers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  transfer_no     TEXT NOT NULL,
  from_location   UUID NOT NULL REFERENCES bms_locations(id),
  to_location     UUID NOT NULL REFERENCES bms_locations(id),
  status          TEXT NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT','IN_TRANSIT','RECEIVED','CANCELLED')),
  note            TEXT,
  created_by      UUID NOT NULL REFERENCES users(id),
  sent_by         UUID REFERENCES users(id),
  sent_at         TIMESTAMPTZ,
  received_by     UUID REFERENCES users(id),
  received_at     TIMESTAMPTZ,
  cancelled_by    UUID REFERENCES users(id),
  cancelled_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, transfer_no),
  -- ย้ายเข้าตัวเองไม่ได้ — เป็นการกดผิดเสมอ และทำให้สต็อกดูเหมือนหายแล้วโผล่
  CHECK (from_location <> to_location)
);

CREATE TABLE IF NOT EXISTS bms_stock_transfer_items (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  transfer_id     UUID NOT NULL REFERENCES bms_stock_transfers(id) ON DELETE CASCADE,
  product_sku     TEXT NOT NULL,
  size            TEXT NOT NULL,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  -- จำนวนที่รับจริงอาจน้อยกว่าที่ส่ง (แตก/หาย/นับผิดตอนแพ็ก) ส่วนต่างต้องเห็น
  -- ไม่ใช่ให้ปลายทางรับเท่าที่ระบบบอกแล้วของขาดหายเงียบ ๆ
  received_qty    INTEGER CHECK (received_qty >= 0),
  UNIQUE (transfer_id, product_sku, size),
  -- composite FK: bms_products มี PK (tenant_id, sku) — บังคับให้ร้านของรายการ
  -- ตรงกับร้านของสินค้าเสมอ ไม่ใช่แค่ว่า sku นั้นมีอยู่ในร้านใดร้านหนึ่ง
  FOREIGN KEY (tenant_id, product_sku) REFERENCES bms_products(tenant_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_bms_stock_transfers_status
  ON bms_stock_transfers (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bms_stock_transfer_items_transfer
  ON bms_stock_transfer_items (tenant_id, transfer_id);

-- ---- 3. นับสต็อก -----------------------------------------------------
-- กับดักของการนับสต็อก: ระหว่างที่คนเดินนับ ร้านยังขายอยู่ ถ้าตอน apply เอา
-- "จำนวนที่นับได้" ไปทับ current_stock ตรง ๆ ของที่ขายไประหว่างนับจะถูกเสก
-- กลับมา · จึงเก็บ snapshot_qty ตอนที่เพิ่มรายการเข้าใบนับ แล้ว apply เป็น
-- ส่วนต่าง (counted − snapshot) ไม่ใช่ค่าสัมบูรณ์ — ยอดขายระหว่างนับจึงรอด
CREATE TABLE IF NOT EXISTS bms_stock_counts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  count_no        TEXT NOT NULL,
  location_id     UUID NOT NULL REFERENCES bms_locations(id),
  status          TEXT NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT','APPLIED','CANCELLED')),
  note            TEXT,
  created_by      UUID NOT NULL REFERENCES users(id),
  applied_by      UUID REFERENCES users(id),
  applied_at      TIMESTAMPTZ,
  cancelled_by    UUID REFERENCES users(id),
  cancelled_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, count_no)
);

CREATE TABLE IF NOT EXISTS bms_stock_count_items (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  count_id        UUID NOT NULL REFERENCES bms_stock_counts(id) ON DELETE CASCADE,
  product_sku     TEXT NOT NULL,
  size            TEXT NOT NULL,
  -- ยอดในระบบ ณ วินาทีที่เพิ่มรายการนี้เข้าใบนับ
  snapshot_qty    INTEGER NOT NULL,
  counted_qty     INTEGER NOT NULL CHECK (counted_qty >= 0),
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (count_id, product_sku, size),
  FOREIGN KEY (tenant_id, product_sku) REFERENCES bms_products(tenant_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_bms_stock_counts_status
  ON bms_stock_counts (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bms_stock_count_items_count
  ON bms_stock_count_items (tenant_id, count_id);

-- ---- 4. RLS + GRANT (copy 4.2 / 4.3) --------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bms_stock_transfers',
    'bms_stock_transfer_items',
    'bms_stock_counts',
    'bms_stock_count_items'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format($p$
      CREATE POLICY %I ON %I
        USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
        WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
    $p$, t || '_tenant_isolation', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  bms_stock_transfers,
  bms_stock_transfer_items,
  bms_stock_counts,
  bms_stock_count_items
TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- ---- 5. permission ใหม่ + seed ทุกร้าน ------------------------------
-- inventory.count.apply แยกจาก inventory.count โดยตั้งใจ: การ "นับ" คือการ
-- กรอกตัวเลข ส่วนการ "ยืนยัน" คือการยอมรับว่าของหายไปเท่านั้นจริง ซึ่งเป็นการ
-- ตัดสินใจทางบัญชี ไม่ใช่งานเดินนับของ · คนเดินนับกับคนเซ็นรับผลควรคนละคน
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager','inventory.transfer'),
  ('Manager','inventory.count'),
  ('Manager','inventory.count.apply'),
  ('Warehouse','inventory.transfer'),
  ('Warehouse','inventory.count')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
