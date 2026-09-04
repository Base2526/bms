-- 9.58 — ชื่อกลุ่มตัวเลือกที่ backfill มาจาก 9.51 เป็นคำว่า "Options" ภาษาอังกฤษ
--
-- 9.51 ยก modifier ยุคก่อนหน้าเข้ากลุ่มโดยตั้งชื่อกลุ่มเป็น 'Options' (ดูบรรทัด INSERT ...
-- SELECT DISTINCT ... 'OPTIONS', 'Options' ในไฟล์นั้น) · ชื่อนี้ถูกแสดงให้พนักงานเห็นบน
-- กล่องเพิ่มเมนูของเครื่องขายซึ่งเป็นไทยล้วน จึงอ่านเป็นภาษาอังกฤษอยู่คำเดียวกลางจอ
--
-- แก้เฉพาะแถวที่ยังเป็นค่า backfill เป๊ะ ๆ (code = 'OPTIONS' และชื่อยังเป็น 'Options')
-- ร้านที่เปลี่ยนชื่อกลุ่มเองไปแล้วจะไม่ถูกแตะ
UPDATE bms_product_modifier_groups
   SET name = 'ตัวเลือก', updated_at = now()
 WHERE code = 'OPTIONS'
   AND name = 'Options';
