-- =============================================================
-- 10.10  ทิศทางของการปรับยอดจากการนับสต็อก (COUNT_ADJUST)
-- -------------------------------------------------------------
-- ต้นเหตุ: bms_stock_movements.qty เป็นบวกเสมอ (CHECK qty > 0) และทิศทางบอกด้วย type
-- แต่ COUNT_ADJUST (7.98) ใช้ได้ทั้งนับเพิ่มและนับลด โค้ดจึงเก็บ Math.abs(delta) ทิ้งทิศทาง
-- ไว้ในข้อความ note อย่างเดียว → รายงานสินค้าและวัตถุดิบ (รับเข้า/จ่ายออก/คงเหลือ) สร้างจาก
-- ledger ไม่ได้ เพราะไม่รู้ว่าแถวนั้นบวกหรือลบ
--
-- ไฟล์นี้:
--   1. เพิ่ม direction ('IN' | 'OUT') — ใช้กับ COUNT_ADJUST เท่านั้น แถวชนิดอื่นเป็น NULL
--   2. backfill จาก note ที่ stockCounts.ts เขียนไว้ตรงตัว "ระบบ X นับได้ Y" (delta = Y − X)
--   3. CHECK ว่า COUNT_ADJUST ใหม่ต้องมีทิศทาง — NOT VALID เพื่อไม่ให้แถวเก่าที่อ่าน note
--      ไม่ออก (ถ้ามี) ทำให้ migration ล้ม · รายงานแสดงแถวพวกนั้นเป็น "ไม่ทราบทิศทาง"
--
-- ❗ โค้ดเขียนคอลัมน์นี้เฉพาะตอนปรับยอดจากการนับ ไม่แตะเส้นทางขาย/รับของ/โอน
--    ฐานที่ยังไม่ apply ไฟล์นี้ = "ยืนยันผลการนับ" ล้ม ส่วนการขายยังทำงานปกติ
--
-- ก่อนรัน (read-only):
--   SELECT count(*) FILTER (WHERE note ~ 'ระบบ -?[0-9]+ นับได้ -?[0-9]+') AS parsable, count(*)
--     FROM bms_stock_movements WHERE type = 'COUNT_ADJUST';
-- =============================================================

BEGIN;

ALTER TABLE bms_stock_movements
  ADD COLUMN IF NOT EXISTS direction TEXT
    CHECK (direction IS NULL OR direction IN ('IN', 'OUT'));

COMMENT ON COLUMN bms_stock_movements.direction IS
  'ทิศทางของ COUNT_ADJUST (IN = นับได้มากกว่าระบบ, OUT = นับได้น้อยกว่า) · ชนิดอื่นบอกทิศทางด้วย type เอง (10.10)';

UPDATE bms_stock_movements m
   SET direction = CASE WHEN (x.parts)[2]::bigint > (x.parts)[1]::bigint THEN 'IN' ELSE 'OUT' END
  FROM (
    SELECT id, regexp_match(note, 'ระบบ (-?[0-9]+) นับได้ (-?[0-9]+)') AS parts
      FROM bms_stock_movements
     WHERE type = 'COUNT_ADJUST' AND direction IS NULL
  ) x
 WHERE m.id = x.id
   AND x.parts IS NOT NULL
   AND (x.parts)[2]::bigint <> (x.parts)[1]::bigint;

ALTER TABLE bms_stock_movements
  DROP CONSTRAINT IF EXISTS bms_stock_movements_count_direction_required;
ALTER TABLE bms_stock_movements
  ADD CONSTRAINT bms_stock_movements_count_direction_required
  CHECK (type <> 'COUNT_ADJUST' OR direction IS NOT NULL) NOT VALID;

COMMIT;

-- ตรวจหลังรัน — แถว COUNT_ADJUST ที่ยังไม่มีทิศทาง (ควรเป็น 0):
--   SELECT count(*) FROM bms_stock_movements WHERE type = 'COUNT_ADJUST' AND direction IS NULL;
--
-- ROLLBACK:
-- ALTER TABLE bms_stock_movements DROP CONSTRAINT IF EXISTS bms_stock_movements_count_direction_required;
-- ALTER TABLE bms_stock_movements DROP COLUMN IF EXISTS direction;
