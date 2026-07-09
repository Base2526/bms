-- =============================================================
-- 5.9  BMS Products — เพิ่มรูปภาพ + รายละเอียด + ต้นทุน + หมวดหมู่ + ยี่ห้อ
-- -------------------------------------------------------------
-- image_url    : รูปหลักของสินค้า (path จาก /api/bms/products/upload)
-- description  : รายละเอียดสินค้า (โชว์ลูกค้า/ให้ AI ตอบคำถามได้แม่นขึ้น)
-- cost_price   : ต้นทุน (ใช้คำนวณกำไรใน Reports — เดิมมีแต่ price ขาย ไม่มีต้นทุนเลย)
-- category/brand : ข้อความอิสระ (ไม่ใช่ FK) เพื่อความง่าย — filter ด้วย ILIKE/GROUP BY ได้
-- รันซ้ำได้ปลอดภัย
-- =============================================================

ALTER TABLE bms_products ADD COLUMN IF NOT EXISTS image_url   TEXT;
ALTER TABLE bms_products ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE bms_products ADD COLUMN IF NOT EXISTS cost_price  NUMERIC(12,2);
ALTER TABLE bms_products ADD COLUMN IF NOT EXISTS category    TEXT;
ALTER TABLE bms_products ADD COLUMN IF NOT EXISTS brand       TEXT;

CREATE INDEX IF NOT EXISTS idx_bms_products_category ON bms_products(tenant_id, category) WHERE category IS NOT NULL;
