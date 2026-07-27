-- =============================================================
-- 7.29  users — last login timestamp
-- -------------------------------------------------------------
-- เดิมไม่มีการ track ว่า user login ล่าสุดเมื่อไหร่เลย (loginAdmin ออก JWT + set cookie แต่ไม่เคย
-- UPDATE อะไรกลับเข้า users) เพิ่มคอลัมน์นี้ให้ /admin/users แสดง "Last Login" ต่อ user ได้จริง
-- =============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
