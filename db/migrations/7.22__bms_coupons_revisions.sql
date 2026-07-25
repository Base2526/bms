-- =============================================================
-- 7.22  BMS coupons revision table
-- -------------------------------------------------------------
-- โค้ดส่วนลดกระทบราคา/margin โดยตรง การแก้ค่า (เช่น 10% → 5%) ควรมี
-- ประวัติ before/after เหมือน products/orders/payments เพื่อตอบคำถามว่า
-- "ใครแก้อะไรเมื่อไหร่" ได้ครบ ไม่ใช่แค่ audit log ที่บอก who/when (target=code)
-- แต่ไม่บอกว่าค่าเปลี่ยนจากอะไรเป็นอะไร
--
-- trigger บันทึก snapshot ของแถว *ก่อน UPDATE* เท่านั้น (BEFORE UPDATE) —
-- การสร้างโค้ดใหม่ (INSERT) จะไม่มี revision row (เหมือน products SKU ใหม่ —
-- ไม่ใช่บั๊ก) · ตาราง bms_coupons ไม่มี PII/secret (ต่างจาก users ที่ห้าม
-- revision เพราะจะ snapshot password_hash — ดู 7.16) จึง snapshot ทั้งแถวได้
-- =============================================================

SELECT public.create_revision_trigger('bms_coupons');
