-- =============================================================
-- 9.68 — ดัชนีของ "กระดานครัว" ให้ต้นทุนขึ้นกับงานที่ค้างอยู่ ไม่ใช่อายุของร้าน
-- -------------------------------------------------------------
-- อาการจากหน้าร้าน (2026-09-08): ส่งครัวแล้วรอ 3-5 นาทีกว่าตั๋วจะขึ้นจอครัว
-- **ทั้งที่จอเปิดค้างอยู่ที่แท็บครัวและจอไม่ดับ** จึงไม่ใช่การหรี่ timer ของเบราว์เซอร์
--
-- ต้นเหตุ: `listKitchenTickets()` UNION ตั๋วสองตาราง แล้วค่อยกรองสถานะ *ข้างนอก* subquery
-- ดัชนีที่มีอยู่ (`idx_bms_kitchen_tickets_queue`, `idx_bms_restaurant_kitchen_queue`) ขึ้นต้น
-- ด้วย `station` ซึ่ง query นี้ไม่ได้กรอง → Postgres อ่านตั๋ว **ทั้งประวัติของร้าน** join กับ
-- order items/checks/tables แล้วค่อยเรียงและตัด 200 ใบ
--
-- ต้นทุนจึงโตทุกวันที่ร้านเปิด: ร้านที่ขายมาสามเดือนอ่านตั๋วหลายหมื่นใบทุก 5 วินาที
-- และเมื่อรอบ poll เดิมไม่มีด่านกันรอบซ้อน คำขอก็ทับกันจนคำตอบใหม่สุดช้าเป็นนาที
--
-- ดัชนีชุดนี้เป็น **partial** โดยตั้งใจ: ตั๋วที่ยังไม่จบมีอยู่ไม่กี่สิบใบเสมอไม่ว่าร้านจะเปิดมา
-- กี่ปี ดัชนีจึงเล็กคงที่ และการอ่านกระดานมีต้นทุนเท่ากับ "ครัวยุ่งแค่ไหนตอนนี้"
--
-- ⚠️ predicate ของดัชนีต้องตรงกับที่ SQL เขียนเป๊ะ ๆ (ค่าคงที่ ไม่ใช่พารามิเตอร์) ไม่งั้น
-- planner พิสูจน์ไม่ได้ว่าใช้ได้ แล้วดัชนีจะถูกสร้างทิ้งไว้เฉย ๆ โดยไม่มีใครใช้ —
-- `kitchen.ts` จึงประกอบรายการสถานะเป็น literal ลงใน SQL และมีเทสตรึงว่าสองฝั่งตรงกัน
--
-- ⚠️ `CREATE INDEX` ล็อกเขียนของตารางนั้นสั้น ๆ — ตารางตั๋วเล็กกว่าตารางสินค้ามาก แต่ให้รัน
-- ตอนไม่มีใครส่งครัวอยู่ (ระหว่างกะ/ก่อนเปิดร้าน) ตามธรรมเนียมเดียวกับ `7.99`
--
-- ROLLBACK: DROP INDEX IF EXISTS idx_bms_kitchen_tickets_board_open,
--   idx_bms_kitchen_tickets_board_served, idx_bms_restaurant_kitchen_board_open,
--   idx_bms_restaurant_kitchen_board_served;
--   (ถอนแล้วกระดานยังทำงานถูกต้อง แค่กลับไปช้าตามเดิม — ไม่มีข้อมูลเปลี่ยน)
-- =============================================================

-- ตั๋วที่ยังไม่จบ: กระดานเห็นเสมอไม่ว่าสร้างเมื่อไร จึงไม่มีขอบเวลาใน predicate
CREATE INDEX IF NOT EXISTS idx_bms_kitchen_tickets_board_open
  ON bms_kitchen_tickets (tenant_id, created_at DESC)
  WHERE status IN ('NEW', 'PREPARING', 'READY');

-- ตั๋วที่เสิร์ฟแล้ว: กระดานเห็นเฉพาะ 12 ชั่วโมงล่าสุด ซึ่งวัดจาก `updated_at` (เวลาที่กดเสิร์ฟ)
-- ไม่ใช่ `created_at` — ดัชนีจึงต้องเรียงด้วย updated_at ให้ตรงกับตัวกรอง
CREATE INDEX IF NOT EXISTS idx_bms_kitchen_tickets_board_served
  ON bms_kitchen_tickets (tenant_id, updated_at DESC)
  WHERE status = 'SERVED';

CREATE INDEX IF NOT EXISTS idx_bms_restaurant_kitchen_board_open
  ON bms_restaurant_kitchen_tickets (tenant_id, created_at DESC)
  WHERE status IN ('NEW', 'PREPARING', 'READY');

CREATE INDEX IF NOT EXISTS idx_bms_restaurant_kitchen_board_served
  ON bms_restaurant_kitchen_tickets (tenant_id, updated_at DESC)
  WHERE status = 'SERVED';

-- ตั๋วที่ถูกยกเลิกไม่ขึ้นกระดานเลย (9.40) จึงไม่มีดัชนีให้โดยตั้งใจ — การไล่หาตั๋วที่ยกเลิก
-- เป็นงานรายงาน ไม่ใช่งานที่ยิงทุก 5 วินาทีจากจอครัว
