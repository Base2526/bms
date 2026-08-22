-- =============================================================
-- 7.46 — ขนส่งที่ร้านเปิดใช้ + ขนส่งที่ลูกค้าอยากให้ส่ง
-- -------------------------------------------------------------
-- bms_store_profile.enabled_carriers
--   รายการ carrier ที่ร้าน "ใช้จริง" (subset ของ CARRIERS ใน lib/bms/shipping.ts)
--   ว่าง = ยังไม่ระบุ → AI ต้องไม่เสนอตัวเลือกขนส่งให้ลูกค้าเลย
--
-- bms_orders.preferred_carrier
--   ขนส่งที่ลูกค้าแจ้งไว้ตอนสั่ง = "ความต้องการเบื้องต้น" ไม่ใช่คำมั่นสัญญา
--   ตัวจริงที่ส่งคือ bms_shipments.carrier ซึ่งแอดมินยืนยันตอนแพ็คของ
--   (ยังไม่ผูก carrier API จริง — ไม่มี rate/ETA จริงมาเทียบให้ลูกค้า)
--
-- ไม่มี FK/CHECK constraint กับรายชื่อ carrier โดยเจตนา — validate ที่ service layer
-- (storeProfile.ts / orders.ts) แบบเดียวกับ business_type/ai_language เดิม
-- bms_store_profile_rev_trg + bms_orders revision trigger ใช้ to_jsonb(OLD)
-- จึง snapshot คอลัมน์ใหม่ให้เองอัตโนมัติ ไม่ต้องแก้ trigger
-- =============================================================

ALTER TABLE bms_store_profile
  ADD COLUMN IF NOT EXISTS enabled_carriers TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE bms_orders
  ADD COLUMN IF NOT EXISTS preferred_carrier TEXT;
