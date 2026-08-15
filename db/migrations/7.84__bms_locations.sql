-- =============================================================
-- 7.84  BMS Locations — มิติสาขาสำหรับ inventory / orders / movements
-- -------------------------------------------------------------
-- เพิ่มสาขา (location) เข้าไปในสายสต๊อกทั้งเส้น ตอนที่ยังมีสาขาเดียว
-- เพราะ backfill ตอนนี้ = ทุกแถวเป็น MAIN (ไม่ต้องตัดสินใจอะไร)
-- ถ้ารอจนมีหลายสาขาจริงจะต้องมาไล่ตอบทีละ SKU ว่าของก้อนนี้อยู่สาขาไหน
--
-- ทำอะไรบ้าง:
--   • bms_locations (รหัสสาขา ภ.พ.20 + ใบอนุญาตขายยา + เภสัชกรผู้มีหน้าที่)
--   • seed 1 สาขา 'MAIN' ต่อ tenant แล้ว backfill ทุกแถวไปที่สาขานั้น
--   • re-key bms_inventory: (tenant_id, product_sku, size)
--                        → (tenant_id, location_id, product_sku, size)
--   • bms_orders / bms_order_items / bms_stock_movements ได้ location_id
--
-- ⚠️ สำคัญ — อ่านก่อน apply:
--   หลัง migration นี้ โค้ดเดิมที่ query แบบ
--     WHERE tenant_id = $1 AND product_sku = $2 AND size = $3
--   จะยัง "ทำงานถูก" ตราบใดที่มีสาขาเดียว เพราะยังเจอแถวเดียว
--   แต่จะ **ผิดเงียบ ๆ ทันทีที่สร้างสาขาที่ 2** (ได้หลายแถว / ตัดผิดสาขา)
--   → ต้องแก้ทั้ง 49 จุดใน 13 ไฟล์ที่อ้าง bms_inventory ให้ส่ง location_id
--     ให้เสร็จก่อนสร้าง location แถวที่สอง
--   ดูรายการไฟล์: grep -rl "bms_inventory" apps/web --include="*.ts"
--
-- รันซ้ำได้ปลอดภัย (guard ทุกขั้น)
-- =============================================================

-- ---- 1. ตารางสาขา ----------------------------------------------------
CREATE TABLE IF NOT EXISTS bms_locations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  code                  TEXT NOT NULL,                       -- รหัสภายใน เช่น MAIN, BR02
  name                  TEXT NOT NULL,

  -- ภาษี: ใบกำกับภาษีต้องระบุสาขาเสมอ ('00000' = สำนักงานใหญ่)
  branch_code           TEXT NOT NULL DEFAULT '00000',       -- เลขที่สาขา (ภ.พ.20)
  is_head_office        BOOLEAN NOT NULL DEFAULT TRUE,
  vat_code              TEXT,                                -- Vat Code บนใบกำกับอย่างย่อ

  address               TEXT,
  phone                 TEXT,

  -- ร้านยา: ใบอนุญาตผูกกับ "สถานที่" ไม่ใช่นิติบุคคล → ต้องแยกต่อสาขา
  pharmacy_license_no   TEXT,                                -- ใบอนุญาตขายยา
  pharmacist_name       TEXT,                                -- เภสัชกรผู้มีหน้าที่ปฏิบัติการ
  pharmacist_license_no TEXT,

  active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_bms_locations_tenant
  ON bms_locations (tenant_id) WHERE active;

-- branch_code ต้องไม่ซ้ำในร้านเดียวกัน (สรรพากรออกให้ไม่ซ้ำอยู่แล้ว)
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_locations_branch_code
  ON bms_locations (tenant_id, branch_code);

-- ---- 2. seed สาขาแรกให้ทุก tenant ที่ยังไม่มี ------------------------
INSERT INTO bms_locations (tenant_id, code, name, branch_code, is_head_office)
SELECT t.id, 'MAIN', COALESCE(NULLIF(t.name, ''), 'สาขาหลัก'), '00000', TRUE
  FROM bms_tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM bms_locations l WHERE l.tenant_id = t.id AND l.code = 'MAIN'
 );

-- ---- 3. เติม location_id + backfill + NOT NULL + FK ------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['bms_inventory','bms_orders','bms_order_items','bms_stock_movements']
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS location_id UUID', t);

    EXECUTE format($f$
      UPDATE %I x
         SET location_id = l.id
        FROM bms_locations l
       WHERE l.tenant_id = x.tenant_id
         AND l.code = 'MAIN'
         AND x.location_id IS NULL
    $f$, t);

    EXECUTE format('ALTER TABLE %I ALTER COLUMN location_id SET NOT NULL', t);

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t||'_location_fk') THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (location_id) REFERENCES bms_locations(id)',
        t, t||'_location_fk'
      );
    END IF;
  END LOOP;
END $$;

-- ---- 4. re-key bms_inventory ----------------------------------------
-- ต้อง drop FK ของ order_items ก่อน เพราะมันชี้มาที่ PK เดิม
ALTER TABLE bms_order_items DROP CONSTRAINT IF EXISTS bms_order_items_inv_fk;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_inventory'::regclass AND contype = 'p'
       AND pg_get_constraintdef(oid) LIKE '%location_id%'
  ) THEN
    ALTER TABLE bms_inventory DROP CONSTRAINT bms_inventory_pkey;
    ALTER TABLE bms_inventory ADD PRIMARY KEY (tenant_id, location_id, product_sku, size);
  END IF;
END $$;

-- คืน FK เดิมพร้อมมิติสาขา — บิลต้องตัดของจากสาขาที่มีสินค้านั้นจริง
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_order_items_inv_fk') THEN
    ALTER TABLE bms_order_items ADD CONSTRAINT bms_order_items_inv_fk
      FOREIGN KEY (tenant_id, location_id, product_sku, size)
      REFERENCES bms_inventory (tenant_id, location_id, product_sku, size);
  END IF;
END $$;

-- index สำหรับอ่านสต๊อกรายสาขา (หน้า POS ใช้บ่อยที่สุด)
CREATE INDEX IF NOT EXISTS idx_bms_inventory_location
  ON bms_inventory (tenant_id, location_id, product_sku);

CREATE INDEX IF NOT EXISTS idx_bms_orders_location
  ON bms_orders (tenant_id, location_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bms_movements_location
  ON bms_stock_movements (tenant_id, location_id, created_at DESC);

-- ---- 5. RLS (copy 4.2) ----------------------------------------------
ALTER TABLE bms_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_locations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_locations_tenant_isolation ON bms_locations;
CREATE POLICY bms_locations_tenant_isolation ON bms_locations
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

-- ---- 6. GRANT (copy 4.3) --------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_locations TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
