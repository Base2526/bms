-- =============================================================
-- 9.7 — bms_app ต้องแก้คอลัมน์ users ที่ POS ใช้งานได้
-- -------------------------------------------------------------
-- หน้าเตรียม POS ฝั่งหลังบ้านเรียก beginTenantTx() ก่อนตั้ง/ล้าง PIN และ
-- เปิด/ปิดโหมด pos_only ซึ่งลดสิทธิ์เป็น bms_app เพื่อให้ RLS enforce จริง
-- แต่ก่อนหน้านี้เรา grant ให้ bms_app อ่าน users ได้อย่างเดียว (8.4)
-- พอ flow เหล่านี้ UPDATE users จึงล้มด้วย
--   permission denied for table users
--
-- เปิดให้น้อยที่สุด:
--   - คอลัมน์ PIN ของพนักงานหน้าร้าน
--   - ธง pos_only สำหรับบล็อกทางเข้าหลังบ้านของบัญชีแคชเชียร์
--
-- ไม่ grant ทั้งตาราง และไม่แตะ password_hash
-- =============================================================

GRANT UPDATE (
  pos_pin_hash,
  pos_pin_set_at,
  pos_pin_failures,
  pos_pin_locked_until,
  pos_only
) ON users TO bms_app;
