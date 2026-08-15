-- =============================================================
-- 7.86  BMS Product Packs — หน่วยขาย (แผง / กล่อง) พร้อมบาร์โค้ดแยก
-- -------------------------------------------------------------
-- ร้านยาขายทั้ง "แผง" และ "กล่อง" โดยแต่ละหน่วยมี QR/บาร์โค้ดของตัวเอง
-- และราคาต่อกล่องถูกกว่าซื้อแยกแผง
--
-- แนวทางที่เลือก (ทางเลือก B): SKU เดียว + สต๊อกนับเป็น "หน่วยฐาน"
--   สต๊อก 70 แผง
--   pack STRIP  ×1   ฿25   barcode 8850001
--   pack BOX    ×10  ฿230  barcode 8850002   → ยิงกล่อง = ตัด 10 แผง
--
-- ทางเลือกที่ไม่เอา (ทางเลือก A: แยกเป็น 2 SKU) เพราะจะเจอ
-- "แผงหมดแต่กล่องยังมี → ขายไม่ได้ ต้องกดแตกกล่องก่อน" ทุกวันหน้าเคาน์เตอร์
-- และ lot ต้องผูก 2 ที่
--
-- ต้องรัน 7.84 ก่อน (ไม่ผูกกับ 7.85 โดยตรง แต่ควรรันตามลำดับ)
-- รันซ้ำได้ปลอดภัย
-- =============================================================

-- ---- 1. หน่วยขายต่อสินค้า -------------------------------------------
CREATE TABLE IF NOT EXISTS bms_product_packs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  product_sku  TEXT NOT NULL,

  pack_code    TEXT NOT NULL,                                   -- STRIP / BOX / PIECE
  unit_name    TEXT NOT NULL,                                   -- ชื่อที่พิมพ์บนใบเสร็จ: แผง / กล่อง
  base_qty     INTEGER NOT NULL CHECK (base_qty > 0),           -- กี่หน่วยฐานต่อ 1 pack
  barcode      TEXT,                                            -- QR/บาร์โค้ดของหน่วยนี้
  price        NUMERIC(12,2) CHECK (price IS NULL OR price >= 0),
                                                                -- NULL = base_qty × bms_products.price
  is_base      BOOLEAN NOT NULL DEFAULT FALSE,                  -- หน่วยที่สต๊อกนับเป็น (base_qty ต้อง = 1)
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, product_sku, pack_code),
  CHECK (NOT is_base OR base_qty = 1),
  FOREIGN KEY (tenant_id, product_sku)
    REFERENCES bms_products (tenant_id, sku) ON DELETE CASCADE
);

-- บาร์โค้ดห้ามซ้ำในร้านเดียวกัน — ยิงแล้วต้องได้คำตอบเดียว
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_product_packs_barcode
  ON bms_product_packs (tenant_id, barcode) WHERE barcode IS NOT NULL;

-- หน่วยฐานต้องมีตัวเดียวต่อสินค้า
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_product_packs_base
  ON bms_product_packs (tenant_id, product_sku) WHERE is_base;

CREATE INDEX IF NOT EXISTS idx_bms_product_packs_sku
  ON bms_product_packs (tenant_id, product_sku) WHERE active;

-- ---- 2. backfill หน่วยฐานให้สินค้าเดิมทุกตัว -------------------------
-- ย้าย bms_products.barcode มาเป็นบาร์โค้ดของหน่วยฐาน
-- (คอลัมน์เดิมยังอยู่ — products.ts ยังค้นหาจากมัน จะเลิกใช้ตอน POS ขึ้น)
INSERT INTO bms_product_packs
  (tenant_id, product_sku, pack_code, unit_name, base_qty, barcode, price, is_base)
SELECT p.tenant_id, p.sku, 'BASE', 'ชิ้น', 1, p.barcode, NULL, TRUE
  FROM bms_products p
 WHERE NOT EXISTS (
   SELECT 1 FROM bms_product_packs k
    WHERE k.tenant_id = p.tenant_id AND k.product_sku = p.sku AND k.is_base
 )
   -- ข้ามตัวที่บาร์โค้ดจะไปชนกับ pack ที่มีอยู่แล้ว (กรณีรันซ้ำหลังแก้มือ)
   AND (p.barcode IS NULL OR NOT EXISTS (
     SELECT 1 FROM bms_product_packs k2
      WHERE k2.tenant_id = p.tenant_id AND k2.barcode = p.barcode
   ));

-- ---- 3. บิลต้องจำว่าขายเป็นหน่วยอะไร --------------------------------
-- qty ใน bms_order_items ยังเป็น "หน่วยฐาน" เสมอ (ตัดสต๊อกตรงไปตรงมา)
-- 3 คอลัมน์นี้เก็บ snapshot ไว้พิมพ์ใบเสร็จว่า "1 กล่อง @230" ไม่ใช่ "10 แผง @23"
ALTER TABLE bms_order_items
  ADD COLUMN IF NOT EXISTS pack_code      TEXT,
  ADD COLUMN IF NOT EXISTS pack_unit_name TEXT,
  ADD COLUMN IF NOT EXISTS pack_qty       INTEGER
    CHECK (pack_qty IS NULL OR pack_qty > 0),                   -- จำนวน pack ที่ลูกค้าซื้อ
  ADD COLUMN IF NOT EXISTS pack_unit_price NUMERIC(12,2)
    CHECK (pack_unit_price IS NULL OR pack_unit_price >= 0);    -- ราคาต่อ pack ณ ตอนขาย

-- ---- 4. RLS (copy 4.2) ----------------------------------------------
ALTER TABLE bms_product_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_product_packs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_product_packs_tenant_isolation ON bms_product_packs;
CREATE POLICY bms_product_packs_tenant_isolation ON bms_product_packs
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

-- ---- 5. GRANT (copy 4.3) --------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_product_packs TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
