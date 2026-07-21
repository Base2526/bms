-- =============================================================
-- 6.9  BMS store profile — ข้อมูลร้านที่ลูกค้าถามบ่อย + ตั้งค่าค่าส่ง
-- -------------------------------------------------------------
-- เดิมไม่มีที่เก็บ "ข้อมูลร้าน" เลย (เวลาเปิด-ปิด / ที่อยู่ / นโยบายส่ง-คืน /
--   บัญชีรับเงิน / ค่าส่ง) — AI ตอบคำถามพวกนี้ไม่ได้เพราะไม่มี fact ให้ดึง
-- ตารางนี้ 1 แถวต่อร้าน (PK = tenant_id) ให้ tool get_store_info /
--   get_payment_info / get_shipping_estimate ดึงไปตอบลูกค้า (facts จริง ไม่เดา)
-- payment_accounts = บัญชีรับเงินของ "ร้านเอง" (ตั้งใจให้ลูกค้าเห็น ไม่ใช่ PII บุคคลที่สาม)
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_store_profile (
  tenant_id               UUID PRIMARY KEY REFERENCES bms_tenants(id) ON DELETE CASCADE,
  store_name              TEXT,
  about                   TEXT,
  address                 TEXT,
  phone                   TEXT,
  business_hours          TEXT,          -- freeform เช่น "จ-ศ 9:00-18:00, ส-อา หยุด"
  shipping_policy         TEXT,
  return_policy           TEXT,
  payment_accounts        JSONB NOT NULL DEFAULT '[]',  -- [{type,bankName?,accountName,accountNo?,promptpayId?,note?}]
  shipping_flat_rate      NUMERIC(12,2), -- ค่าส่งเหมาจ่าย (null = ไม่ระบุ)
  shipping_free_threshold NUMERIC(12,2), -- ยอดขั้นต่ำส่งฟรี (null = ไม่มีโปรส่งฟรี)
  shipping_est_days_min   INTEGER,
  shipping_est_days_max   INTEGER,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE bms_store_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_store_profile FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_store_profile_tenant_isolation ON bms_store_profile;
CREATE POLICY bms_store_profile_tenant_isolation ON bms_store_profile
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_store_profile TO bms_app;
