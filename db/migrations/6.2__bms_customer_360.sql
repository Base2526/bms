-- =============================================================
-- 6.2  BMS Customer 360 — โปรไฟล์ลูกค้าละเอียดขึ้น + cache AI insight
-- -------------------------------------------------------------
-- เพิ่ม field ที่ยังไม่มีบน bms_customers (email/preferred_language/timezone
--   — ก่อนหน้านี้มีแค่ name/phone/note/tags) เพื่อรองรับ Customer 360 panel
--   ในหน้า Inbox (ดู BUSINESS_RULES.md § Customer / CLAUDE.md § Customer 360)
-- address_type แยก shipping/billing บน bms_customer_addresses (เดิมมีแค่
--   label อิสระ + is_default ไม่แยกประเภท) — default 'shipping' ให้แถวเดิม
--   ทั้งหมดเป็น shipping ไปก่อน ไม่กระทบข้อมูลเก่า
-- bms_customer_ai_summary = cache ผลสรุป AI ต่อ customer กัน re-generate
--   ทุกครั้งที่เปิดแชท (facts_hash เทียบว่าข้อมูลเปลี่ยนไปหรือยัง)
-- ไม่มี field ใหม่สำหรับ VIP/Fraud Risk — ใช้ tags เดิม (setCustomerTags())
--   ส่วน "ลูกค้าใหม่/ลูกค้าประจำ" คำนวณสดจาก order_count ไม่เก็บเป็น tag
-- =============================================================

ALTER TABLE bms_customers
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS preferred_language TEXT,
  ADD COLUMN IF NOT EXISTS timezone TEXT;

ALTER TABLE bms_customer_addresses
  ADD COLUMN IF NOT EXISTS address_type TEXT NOT NULL DEFAULT 'shipping'
    CHECK (address_type IN ('shipping', 'billing'));

CREATE TABLE IF NOT EXISTS bms_customer_ai_summary (
  tenant_id     UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  customer_id   UUID NOT NULL REFERENCES bms_customers(id) ON DELETE CASCADE,
  summary       JSONB NOT NULL,
  facts_hash    TEXT NOT NULL,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id)
);
CREATE INDEX IF NOT EXISTS idx_bms_cust_ai_summary_tenant ON bms_customer_ai_summary(tenant_id);

-- ---- RLS (เหมือน 6.1) ----
ALTER TABLE bms_customer_ai_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_customer_ai_summary FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_customer_ai_summary_tenant_isolation ON bms_customer_ai_summary;
CREATE POLICY bms_customer_ai_summary_tenant_isolation ON bms_customer_ai_summary
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_customer_ai_summary TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
