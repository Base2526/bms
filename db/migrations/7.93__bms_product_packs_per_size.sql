-- =============================================================
-- 7.93  BMS Product Packs — หน่วยขายผูกกับไซซ์ (บาร์โค้ดต้องนิ่ง)
-- -------------------------------------------------------------
-- ต้องรัน 7.86 ก่อน
--
-- ปัญหา: บาร์โค้ดเก็บที่ bms_products (1 อันต่อสินค้า) แต่สินค้ามีหลายไซซ์
-- ตอนยิงระบบเลยต้อง "เดา" ว่าหมายถึงไซซ์ไหน แล้วเดาด้วยกฎ "ไซซ์ที่เหลือเยอะสุด"
-- → พอสต๊อกขยับ ยิงบาร์โค้ดเดิมได้คนละไซซ์ เจอมาแล้วตอนทดสอบ:
--   ยิงครั้งแรกได้ "10 เม็ด" ขายไปแล้วยิงซ้ำได้ "100 เม็ด"
--
-- ระบบค้าปลีกทั่วไปไม่ทำแบบนี้ — บาร์โค้ด 1 อัน = หน่วยขาย 1 อย่างเสมอ
-- (แผง 10 เม็ดกับกล่อง 100 เม็ดเป็นคนละ EAN) → ย้ายบาร์โค้ดไปอยู่กับ
-- "หน่วยขาย" ซึ่งต้องรู้ไซซ์ของตัวเองด้วย
--
-- ทำอะไร:
--   • bms_product_packs.size — หน่วยขายผูกกับไซซ์ (NULL = ใช้ได้ทุกไซซ์ ของเดิม)
--   • backfill: แตก BASE pack เดิมออกเป็นรายไซซ์ตามที่มีสต็อกจริง
--   • ย้าย bms_products.barcode ไปที่ pack ของไซซ์หลัก (ไซซ์แรกตามตัวอักษร)
--     ให้ยิงแล้วได้ผลเดิมทุกครั้ง ไม่ขึ้นกับสต็อก
--
-- bms_products.barcode ยังอยู่ (products.ts ใช้ค้นหา) — เลิกใช้เมื่อไหร่ค่อยลบ
-- รันซ้ำได้ปลอดภัย
-- =============================================================

-- ---- 1. หน่วยขายรู้ไซซ์ของตัวเอง -------------------------------------
ALTER TABLE bms_product_packs
  ADD COLUMN IF NOT EXISTS size TEXT;

COMMENT ON COLUMN bms_product_packs.size IS
  'ไซซ์ที่หน่วยขายนี้ผูกอยู่ · NULL = ใช้กับทุกไซซ์ (ของเดิมก่อน 7.93)';

-- unique เดิมคือ (tenant, sku, pack_code) → ต้องรวม size ด้วย
-- ไม่งั้นสินค้าเดียวกันมี BASE ของหลายไซซ์พร้อมกันไม่ได้
ALTER TABLE bms_product_packs
  DROP CONSTRAINT IF EXISTS bms_product_packs_tenant_id_product_sku_pack_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_product_packs_sized
  ON bms_product_packs (tenant_id, product_sku, size, pack_code)
  WHERE size IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_product_packs_anysize
  ON bms_product_packs (tenant_id, product_sku, pack_code)
  WHERE size IS NULL;

-- หน่วยฐานมีได้ตัวเดียวต่อ (สินค้า, ไซซ์) — ของเดิมคุมแค่ต่อสินค้า
DROP INDEX IF EXISTS uq_bms_product_packs_base;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_product_packs_base_sized
  ON bms_product_packs (tenant_id, product_sku, size) WHERE is_base AND size IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_product_packs_base_anysize
  ON bms_product_packs (tenant_id, product_sku) WHERE is_base AND size IS NULL;

-- ---- 2. แตก BASE pack เดิมออกเป็นรายไซซ์ -----------------------------
-- สร้าง pack ของทุกไซซ์ที่มีแถวสต็อกจริง (ยกเว้นไซซ์แรกที่จะใช้ต่อจากแถวเดิม)
WITH sized AS (
  SELECT DISTINCT k.tenant_id, k.product_sku, i.size,
         k.pack_code, k.unit_name, k.base_qty, k.price, k.is_base, k.active,
         row_number() OVER (PARTITION BY k.tenant_id, k.product_sku ORDER BY i.size) AS rn
    FROM bms_product_packs k
    JOIN bms_inventory i
      ON i.tenant_id = k.tenant_id AND i.product_sku = k.product_sku
   WHERE k.size IS NULL
)
INSERT INTO bms_product_packs
  (tenant_id, product_sku, size, pack_code, unit_name, base_qty, price, is_base, active)
SELECT tenant_id, product_sku, size, pack_code, unit_name, base_qty, price, is_base, active
  FROM sized
 WHERE rn > 1
ON CONFLICT DO NOTHING;

-- แถวเดิมรับไซซ์แรก (ตามตัวอักษร) — บาร์โค้ดที่ติดอยู่จึงชี้ไปไซซ์นั้นอย่างนิ่ง
UPDATE bms_product_packs k
   SET size = s.size
  FROM (
    SELECT k2.id, min(i.size) AS size
      FROM bms_product_packs k2
      JOIN bms_inventory i
        ON i.tenant_id = k2.tenant_id AND i.product_sku = k2.product_sku
     WHERE k2.size IS NULL
     GROUP BY k2.id
  ) s
 WHERE k.id = s.id;

-- ---- 3. ย้ายบาร์โค้ดของสินค้าไปที่หน่วยฐานของไซซ์หลัก ------------------
-- pack ที่ยังไม่มีบาร์โค้ด และเป็นหน่วยฐานของไซซ์แรก → รับบาร์โค้ดจากสินค้า
UPDATE bms_product_packs k
   SET barcode = p.barcode
  FROM bms_products p
 WHERE p.tenant_id = k.tenant_id
   AND p.sku = k.product_sku
   AND p.barcode IS NOT NULL
   AND k.barcode IS NULL
   AND k.is_base
   AND k.size = (
     SELECT min(i.size) FROM bms_inventory i
      WHERE i.tenant_id = k.tenant_id AND i.product_sku = k.product_sku
   )
   AND NOT EXISTS (
     SELECT 1 FROM bms_product_packs k2
      WHERE k2.tenant_id = k.tenant_id AND k2.barcode = p.barcode
   );
