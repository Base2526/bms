-- =============================================================
-- 7.85  BMS Inventory Lots — lot + วันหมดอายุ (ต้องรัน 7.84 ก่อน)
-- -------------------------------------------------------------
-- โครงสร้าง 2 ชั้น — จงใจไม่เอา lot ไปฝังใน bms_inventory:
--
--   bms_inventory       = ชั้นสรุป   current_stock / reserved_stock ต่อ (สาขา, sku, size)
--   bms_inventory_lots  = ชั้นรายละเอียด  แตกยอดเดียวกันออกเป็นราย lot
--
-- เหตุผล:
--   1. โค้ดเดิม 49 จุดที่อ่าน bms_inventory ไม่ต้องแก้
--   2. กลไกจองสต๊อกแบบ atomic ที่ orders.ts (UPDATE ... WHERE available >= qty)
--      ยังทำงานเหมือนเดิม — ถ้าย้ายไปจองราย lot จะต้องเขียน locking ใหม่ทั้งหมด
--   3. เช็ค "มีของไหม" เร็ว แล้วค่อยเลือก lot ตอนจ่ายของจริง
--
-- ⚠️ invariant ที่ต้องรักษา:
--      SUM(bms_inventory_lots.qty) = bms_inventory.current_stock
--   ต่อ (tenant_id, location_id, product_sku, size)
--   ฐานข้อมูลบังคับให้เองไม่ได้ → ทุก write ต้องผ่าน service เดียว
--   และต้องมี job ตรวจรายวัน (query ตรวจอยู่ท้ายไฟล์นี้)
--
-- การจ่ายของ: FEFO — วันหมดอายุใกล้สุดก่อน · lot ที่หมดอายุแล้วห้ามจ่าย
-- รันซ้ำได้ปลอดภัย
-- =============================================================

-- ---- 1. lot ต่อสาขา --------------------------------------------------
CREATE TABLE IF NOT EXISTS bms_inventory_lots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id   UUID NOT NULL REFERENCES bms_locations(id),
  product_sku   TEXT NOT NULL,
  size          TEXT NOT NULL,

  lot_no        TEXT NOT NULL,                                  -- เลข lot จากผู้ผลิต
  expiry_date   DATE,                                           -- ร้านยาต้องมี · ร้านอื่นปล่อยว่างได้
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  supplier_id   UUID REFERENCES bms_suppliers(id) ON DELETE SET NULL,
  unit_cost     NUMERIC(12,2) CHECK (unit_cost IS NULL OR unit_cost >= 0),

  qty           INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),     -- คงเหลือใน lot นี้
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- lot_no ไม่ซ้ำภายใน (สาขา, สินค้า, size) — expiry เป็นคุณสมบัติของ lot ไม่ใช่ key
  UNIQUE (tenant_id, location_id, product_sku, size, lot_no),
  FOREIGN KEY (tenant_id, location_id, product_sku, size)
    REFERENCES bms_inventory (tenant_id, location_id, product_sku, size) ON DELETE CASCADE
);

-- FEFO: เลือก lot ที่ยังมีของ เรียงตามวันหมดอายุ (NULL = ไม่มีวันหมดอายุ → ท้ายสุด)
CREATE INDEX IF NOT EXISTS idx_bms_inventory_lots_fefo
  ON bms_inventory_lots (tenant_id, location_id, product_sku, size, expiry_date NULLS LAST)
  WHERE qty > 0;

-- รายงาน "ใกล้หมดอายุ" ทั้งร้าน
CREATE INDEX IF NOT EXISTS idx_bms_inventory_lots_expiry
  ON bms_inventory_lots (tenant_id, expiry_date)
  WHERE qty > 0 AND expiry_date IS NOT NULL;

-- ---- 2. บิลไหนได้ lot ไหน (สำหรับเรียกคืน) ---------------------------
CREATE TABLE IF NOT EXISTS bms_order_item_lots (
  id             BIGSERIAL PRIMARY KEY,
  tenant_id      UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  order_item_id  BIGINT NOT NULL REFERENCES bms_order_items(id) ON DELETE CASCADE,
  lot_id         UUID NOT NULL REFERENCES bms_inventory_lots(id),
  qty            INTEGER NOT NULL CHECK (qty > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_item_id, lot_id)
);

-- เรียกคืน: จาก lot → หาบิลทั้งหมดที่จ่าย lot นั้นออกไป
CREATE INDEX IF NOT EXISTS idx_bms_order_item_lots_lot
  ON bms_order_item_lots (lot_id);

CREATE INDEX IF NOT EXISTS idx_bms_order_item_lots_item
  ON bms_order_item_lots (order_item_id);

-- ---- 3. movement รู้จัก lot -----------------------------------------
ALTER TABLE bms_stock_movements
  ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES bms_inventory_lots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bms_movements_lot
  ON bms_stock_movements (lot_id) WHERE lot_id IS NOT NULL;

-- ---- 4. RLS (copy 4.2) ----------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['bms_inventory_lots','bms_order_item_lots']
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

-- ---- 5. GRANT (copy 4.3) --------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_inventory_lots, bms_order_item_lots TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- =============================================================
-- ตรวจ invariant — ต้องได้ผลว่าง ให้ job รายวันรัน query นี้
-- -------------------------------------------------------------
-- SELECT i.tenant_id, i.location_id, i.product_sku, i.size,
--        i.current_stock, COALESCE(SUM(l.qty), 0) AS lot_total
--   FROM bms_inventory i
--   LEFT JOIN bms_inventory_lots l
--     ON  l.tenant_id   = i.tenant_id
--     AND l.location_id = i.location_id
--     AND l.product_sku = i.product_sku
--     AND l.size        = i.size
--  GROUP BY i.tenant_id, i.location_id, i.product_sku, i.size, i.current_stock
-- HAVING i.current_stock <> COALESCE(SUM(l.qty), 0);
--
-- หมายเหตุ: ทันทีหลัง apply ไฟล์นี้ query ข้างบนจะฟ้อง "ทุกแถวที่มีของ"
-- เพราะยังไม่มี lot สักตัว — เป็นเรื่องปกติ ต้องเปิด job ตรวจ
-- หลังจาก backfill lot เข้าไปแล้วเท่านั้น (ดู § วิธี backfill ใน PR)
-- =============================================================
