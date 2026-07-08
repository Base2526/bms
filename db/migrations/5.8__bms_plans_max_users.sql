-- =============================================================
-- 5.8  BMS SaaS — quota จำนวน staff (max_users) ต่อแพ็กเกจ
-- -------------------------------------------------------------
-- limit = -1 หมายถึงไม่จำกัด (ตามรูปแบบเดิมของ bms_plans)
-- ค่าเริ่มต้น: free จำกัดน้อยสุด, business ไม่จำกัด (ดัน upsell)
-- รันซ้ำได้ปลอดภัย
-- =============================================================

ALTER TABLE bms_plans ADD COLUMN IF NOT EXISTS max_users INTEGER NOT NULL DEFAULT -1;

UPDATE bms_plans SET max_users = 3  WHERE code = 'free'     AND max_users = -1;
UPDATE bms_plans SET max_users = 10 WHERE code = 'pro'      AND max_users = -1;
UPDATE bms_plans SET max_users = -1 WHERE code = 'business';
