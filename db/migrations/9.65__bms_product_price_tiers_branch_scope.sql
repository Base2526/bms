-- =============================================================
-- 9.65  ราคาส่งตามจำนวนแยกสาขา (branch-scoped quantity price tiers)
-- -------------------------------------------------------------
-- `8.1` ทำขั้นราคาตามจำนวนไว้ที่ระดับร้านล้วน · `9.61` แยกโปรโมชันตามสาขาไปแล้ว และ
-- จดไว้เองว่าราคาส่งตามจำนวนยัง "เป็นระดับร้านทั้งหมด — แยกสาขาได้แต่ต้องมี migration
-- ของตัวเอง" · ไฟล์นี้คือไฟล์นั้น
--
-- ปัญหาจริง: สาขาค้าส่งริมถนนขาย "ซื้อ 10 ลดเหลือ 80" ขณะที่สาขาในห้างซึ่งค่าเช่าแพงกว่า
-- ขายราคาป้ายเท่ากันทุกจำนวน · ก่อนไฟล์นี้ตั้งได้แบบเดียวทั้งเชน
--
-- ความหมายของคอลัมน์ใหม่ (เหมือน `9.61` ทุกประการ)
--   location_id IS NULL   = ขั้นราคาของทั้งร้าน (พฤติกรรมเดิมของ 8.1)
--   location_id = <สาขา>  = ขั้นราคาของสาขานั้นสาขาเดียว
--
-- ⚠️ กติกา: **ขั้นราคาของสาขา "แทนที่" ขั้นราคาของส่วนกลางทั้งบันได ไม่ใช่ผสมกัน**
--    ต่างจากโปรโมชันตรงที่สินค้าหนึ่งตัวมีขั้นราคาได้ *หลายขั้น* (5 ชิ้น 90 · 10 ชิ้น 80)
--    ถ้าเอาสองชุดมาผสมกันจะได้บันไดที่ไม่มีใครเคยตั้ง เช่นสาขาตั้งไว้ขั้นเดียวที่ 10 ชิ้น
--    แล้วขั้น 5 ชิ้นของส่วนกลางโผล่มาแทรกกลาง — ร้านอธิบายไม่ได้ว่าราคานี้มาจากไหน
--    ประโยคที่พนักงานพูดได้คือ "สาขานี้ตั้งราคาส่งของตัวเองไว้" ซึ่งต้องเป็นชุดเดียวจบ
--
-- ⚠️ แถวเดิมทุกแถวได้ `location_id = NULL` → apply แล้ว **ไม่เปลี่ยนราคาของบิลไหนเลย**
--    จนกว่าจะมีคนไปตั้งขั้นราคารายสาขา
--
-- ⚠️ `uq_bms_product_price_tiers_rule` ต้องรวมสาขาเข้าไปในคีย์ ไม่งั้นสาขาจะตั้งขั้นราคา
--    ที่ min_qty เดียวกับของส่วนกลางไม่ได้เลย ซึ่งเป็นเคสที่พบบ่อยที่สุด (สาขาอยากได้
--    ราคาต่างที่จำนวนเท่ากัน) · NULL ไม่ชนกับ NULL ใน unique index จึงต้องใช้
--    COALESCE ให้ค่ากลางเป็นค่าที่เทียบกันได้ แบบเดียวกับที่คีย์เดิมทำกับ `size`
--
-- ไม่มี permission ใหม่ — ใช้ `product.edit` เดิม (การตั้งขั้นราคาคือการตั้งราคาขาย)
-- ขอบเขตสาขาของคนตั้งอ่านจาก `bms_user_allowed_locations` (9.37) ที่ชั้นแอป
--
-- ROLLBACK (ทำก่อน deploy โค้ดที่อ่านคอลัมน์นี้เท่านั้น):
--   DELETE FROM bms_product_price_tiers WHERE location_id IS NOT NULL;
--   DROP INDEX IF EXISTS uq_bms_product_price_tiers_rule;
--   CREATE UNIQUE INDEX uq_bms_product_price_tiers_rule
--     ON bms_product_price_tiers (tenant_id, product_sku, scope, COALESCE(size, ''), min_qty);
--   ALTER TABLE bms_product_price_tiers
--     DROP CONSTRAINT IF EXISTS bms_product_price_tiers_location_fk,
--     DROP COLUMN IF EXISTS location_id;
-- =============================================================

ALTER TABLE bms_product_price_tiers
  ADD COLUMN IF NOT EXISTS location_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_product_price_tiers'::regclass
       AND conname = 'bms_product_price_tiers_location_fk'
  ) THEN
    ALTER TABLE bms_product_price_tiers
      ADD CONSTRAINT bms_product_price_tiers_location_fk
      FOREIGN KEY (tenant_id, location_id)
      REFERENCES bms_locations (tenant_id, id) ON DELETE CASCADE;
  END IF;
END $$;

DROP INDEX IF EXISTS uq_bms_product_price_tiers_rule;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_product_price_tiers_rule
  ON bms_product_price_tiers (
    tenant_id, product_sku, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    scope, COALESCE(size, ''), min_qty
  );

-- อ่านบันไดของสาขาหนึ่ง ๆ = อ่านสองชุด (ของสาขา + ของส่วนกลาง) ในคำสั่งเดียว
CREATE INDEX IF NOT EXISTS idx_bms_price_tiers_branch_lookup
  ON bms_product_price_tiers (tenant_id, product_sku, location_id, min_qty);

COMMENT ON COLUMN bms_product_price_tiers.location_id IS
  'NULL = store-wide ladder (the 8.1 behaviour). A branch id means that branch only, and a branch '
  'ladder REPLACES the store ladder for that SKU rather than merging with it — merged rungs would '
  'produce a price ladder nobody declared.';
