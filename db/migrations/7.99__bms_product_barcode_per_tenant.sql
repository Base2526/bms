-- =============================================================
-- 7.99 — barcode ของสินค้าต้อง unique "ต่อร้าน" ไม่ใช่ทั้งแพลตฟอร์ม
-- -------------------------------------------------------------
-- 3.4 สร้าง uq_bms_products_barcode เป็น UNIQUE (barcode) เฉย ๆ ตอนที่ระบบยัง
-- เป็นร้านเดียว · พอกลายเป็น multi-tenant index นี้แปลว่า
--
--   สองร้านที่ขายสินค้าตัวเดียวกัน บันทึกบาร์โค้ดจริงของมันได้แค่ร้านเดียว
--
-- ร้านที่มาทีหลังเจอ "duplicate key" ทั้งที่ในร้านตัวเองไม่มีอะไรซ้ำ และมองไม่เห็น
-- ว่าอีกร้านถืออยู่ — เป็น error ที่หาสาเหตุไม่ได้จากฝั่งผู้ใช้เลย · ยิ่งสินค้าที่ขายกัน
-- ทั่ว (สบู่ ยาสีฟัน น้ำหอมแบรนด์ดัง) ยิ่งชนแน่
--
-- bms_product_packs (7.86) ทำถูกอยู่แล้วที่ (tenant_id, barcode) — ตารางสินค้าตกไป
--
-- ปลอดภัยที่จะรัน: index เดิมบังคับ unique ทั้งฐานอยู่แล้ว จึงเป็นไปไม่ได้ที่จะมี
-- barcode ซ้ำค้างอยู่ การคลายเงื่อนไขให้หลวมลงจึงล้มไม่ได้
--
-- ⚠️ ล็อกตาราง bms_products สั้น ๆ ตอน DROP/CREATE INDEX — ตารางนี้เล็ก (สินค้าต่อร้าน
-- หลักร้อย-หลักพัน) แต่ถ้าฐาน production ใหญ่กว่าที่คิด ให้รันตอนไม่มีคนขาย
-- =============================================================

-- ตรวจก่อนเผื่อฐานไหนเคยถูกแก้มือจน index หาย แล้วมีซ้ำค้างอยู่จริง
-- (ถ้าเจอ migration จะหยุดพร้อมบอกว่าซ้ำที่ barcode ไหน ไม่ใช่ล้มแบบไม่มีคำอธิบาย)
DO $$
DECLARE dup TEXT;
BEGIN
  SELECT string_agg(DISTINCT barcode, ', ')
    INTO dup
    FROM (
      SELECT barcode FROM bms_products
       WHERE barcode IS NOT NULL
       GROUP BY tenant_id, barcode
      HAVING COUNT(*) > 1
    ) d;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'มี barcode ซ้ำภายในร้านเดียวกันอยู่ ต้องเคลียร์ก่อน: %', dup;
  END IF;
END $$;

DROP INDEX IF EXISTS uq_bms_products_barcode;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_products_barcode_tenant
  ON bms_products (tenant_id, barcode) WHERE barcode IS NOT NULL;

COMMENT ON INDEX uq_bms_products_barcode_tenant IS
  'barcode ห้ามซ้ำภายในร้าน แต่ซ้ำข้ามร้านได้ — สินค้าตัวเดียวกันมี EAN-13 เดียวกันทุกร้านที่ขายมัน';
