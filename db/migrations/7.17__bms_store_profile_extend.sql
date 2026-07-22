-- =============================================================
-- 7.17  ขยาย bms_store_profile — ข้อมูลติดต่อ/แบรนด์/locale (ให้ Administrator แก้เอง)
-- -------------------------------------------------------------
-- เพิ่ม field ที่ร้านควรตั้งเองได้ + AI/เอกสาร (invoice/quotation) เอาไปใช้:
--   contact_email, logo_url, tax_id, timezone, country, currency, website
-- ทุก field nullable (ไม่บังคับ) · revision-safe: bms_store_profile_rev_trg เก็บ
--   snapshot เป็น jsonb (to_jsonb(OLD)) จึงรองรับคอลัมน์ใหม่อัตโนมัติ
-- หมายเหตุ: store_name เดิม "เลิกใช้แล้ว" — ชื่อร้านใช้ bms_tenants.name อันเดียว
--   (คงคอลัมน์ store_name ไว้เฉย ๆ กันข้อมูลเก่าพัง แต่โค้ด/AI ไม่อ่าน/เขียนแล้ว)
-- =============================================================

ALTER TABLE bms_store_profile ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE bms_store_profile ADD COLUMN IF NOT EXISTS logo_url      TEXT;
ALTER TABLE bms_store_profile ADD COLUMN IF NOT EXISTS tax_id        TEXT;
ALTER TABLE bms_store_profile ADD COLUMN IF NOT EXISTS timezone      TEXT;
ALTER TABLE bms_store_profile ADD COLUMN IF NOT EXISTS country       TEXT;   -- TH / AU / UK
ALTER TABLE bms_store_profile ADD COLUMN IF NOT EXISTS currency      TEXT;   -- THB / AUD / GBP
ALTER TABLE bms_store_profile ADD COLUMN IF NOT EXISTS website       TEXT;
