-- =============================================================
-- 9.61 — โปรโมชันแยกสาขา: แต่ละสาขาตั้งโปรของตัวเองได้อิสระ
-- -------------------------------------------------------------
-- 8.7 ทำโปรไว้ที่ระดับร้าน (tenant) ล้วน · uq_bms_promotions_active_sku บังคับว่า
-- สินค้าหนึ่งตัวมีโปร active ได้ "หนึ่งแบบทั้งร้าน" · เชนที่มีหลายสาขาจึงทำสิ่งที่
-- ร้านค้าปลีกทำกันทุกวันไม่ได้เลย: สาขาหน้าโรงเรียนจัด "3 ชิ้น 100" ระบายของ
-- ใกล้หมดอายุ ขณะที่สาขาในห้างขายราคาปกติ
--
-- ⚠️ ทางที่ "ไม่" เลือก: ตารางเชื่อมแบบ bms_coupon_locations (9.37)
--    คูปองใช้ตารางเชื่อมเพราะคำถามคือ "โค้ดนี้ใช้ได้ที่สาขาไหนบ้าง" — โปรตัวเดียว
--    หลายสาขา · แต่โจทย์นี้คือ "แต่ละสาขามีโปร *คนละแบบ*" ซึ่งตารางเชื่อมตอบไม่ได้
--    เพราะแถวโปรยังมีแถวเดียวต่อ SKU · จึงเก็บสาขาไว้บนแถวโปรเอง
--
-- ความหมายของคอลัมน์ใหม่
--   location_id IS NULL      = โปรของทั้งร้าน (พฤติกรรมเดิมของ 8.7 ทุกประการ)
--   location_id = <สาขา>     = โปรของสาขานั้นสาขาเดียว
--
-- ⚠️ กติกาว่าใครชนะ: **โปรของสาขาทับโปรของส่วนกลาง**
--    8.7 เขียนไว้ว่าห้ามมีสองโปรบนสินค้าเดียวกันเพราะ "ต้องตอบว่าอันไหนชนะ ซึ่งไม่มี
--    คำตอบที่พนักงานอธิบายลูกค้าได้" · กติกานี้ไม่ขัดกับข้อนั้น เพราะคำตอบอธิบายได้
--    ในประโยคเดียว: "สาขานี้ตั้งโปรของตัวเองไว้ ทับของส่วนกลาง" ซึ่งเป็นวิธีที่เชน
--    ค้าปลีกทำงานจริง · และยังคงมีโปรที่ใช้ได้ ณ สาขาหนึ่ง ๆ ได้ทีละหนึ่งแบบเหมือนเดิม
--
-- ⚠️ แถวเดิมทุกแถวได้ location_id = NULL จึงยังเป็นโปรทั้งร้านเหมือนเดิม
--    การ apply ไฟล์นี้ **ไม่เปลี่ยนราคาของบิลไหนเลย** จนกว่าจะมีคนไปตั้งโปรรายสาขา
--
-- ไม่มี permission ใหม่ — ใช้ product.edit เดิมตามเหตุผลของ 8.7 (การตั้งโปรคือ
-- การตั้งราคาขายของสินค้านั้น) · ขอบเขตสาขาของ "คนตั้ง" อ่านจาก
-- bms_user_allowed_locations (9.37) ที่ชั้นแอป ไม่ใช่ที่ชั้นนี้
--
-- ROLLBACK (ถ้าจำเป็น — ทำก่อน deploy โค้ดที่อ่านคอลัมน์นี้เท่านั้น):
--   DELETE FROM bms_product_promotions WHERE location_id IS NOT NULL;
--   DROP INDEX IF EXISTS uq_bms_promotions_active_sku_store;
--   DROP INDEX IF EXISTS uq_bms_promotions_active_sku_branch;
--   CREATE UNIQUE INDEX uq_bms_promotions_active_sku
--     ON bms_product_promotions (tenant_id, product_sku) WHERE active;
--   ALTER TABLE bms_product_promotions
--     DROP CONSTRAINT IF EXISTS bms_product_promotions_location_fk,
--     DROP COLUMN IF EXISTS location_id;
-- =============================================================

ALTER TABLE bms_product_promotions
  ADD COLUMN IF NOT EXISTS location_id UUID;

-- FK แบบ composite: โปรของร้าน A ชี้ไปสาขาของร้าน B ไม่ได้โดยโครงสร้าง
-- (MATCH SIMPLE เป็นค่าปริยาย → แถวที่ location_id เป็น NULL ไม่ถูกบังคับ ซึ่งคือที่ต้องการ)
-- ต้องมี uq_bms_locations_tenant_id จาก 9.37 ก่อน
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bms_product_promotions_location_fk'
  ) THEN
    ALTER TABLE bms_product_promotions
      ADD CONSTRAINT bms_product_promotions_location_fk
      FOREIGN KEY (tenant_id, location_id)
      REFERENCES bms_locations (tenant_id, id) ON DELETE CASCADE;
  END IF;
END $$;

-- ---- unique: หนึ่งโปร active ต่อ (สินค้า × ขอบเขต) ------------------
-- NULL ไม่ชนกับ NULL ใน unique index ธรรมดา จึงต้องแยกเป็นสองดัชนีบางส่วน
-- แบบเดียวกับที่ 9.54 ทำกับสถานีครัวระดับร้าน/ระดับสาขา
DROP INDEX IF EXISTS uq_bms_promotions_active_sku;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_promotions_active_sku_store
  ON bms_product_promotions (tenant_id, product_sku)
  WHERE active AND location_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_promotions_active_sku_branch
  ON bms_product_promotions (tenant_id, product_sku, location_id)
  WHERE active AND location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bms_promotions_location
  ON bms_product_promotions (tenant_id, location_id, active)
  WHERE location_id IS NOT NULL;

COMMENT ON COLUMN bms_product_promotions.location_id IS
  'NULL = โปรทั้งร้าน · มีค่า = โปรของสาขานั้นเท่านั้น และทับโปรทั้งร้านของ SKU เดียวกัน (9.61)';
