-- =============================================================
-- 7.25  Customer coupon wallet (light entitlement table)
-- -------------------------------------------------------------
-- เป้าหมายรอบนี้คือเก็บว่า "ลูกค้าคนนี้มีสิทธิ์คูปองอะไรบ้าง" แบบถาวร
-- โดยยังไม่ทำ claim/reserve/redeem lifecycle เต็มรูปแบบ
--
-- หลักการ:
--   - 1 แถว = customer ได้รับ coupon ใบนั้น
--   - สถานะ "ใช้ได้ไหม" ยังประเมินจาก bms_coupons + ประวัติ bms_orders ตอนอ่าน
--   - ไม่มี used_at / redeemed_count แยกในตารางนี้ (ยังใช้ bms_orders เป็น source of truth)
--   - revoked_at = ถอนสิทธิ์แบบ soft revoke; ถ้าให้ใหม่ภายหลังใช้แถวเดิมแล้ว clear revoked_at
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_customer_coupon_wallet (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  customer_id   UUID NOT NULL REFERENCES bms_customers(id) ON DELETE CASCADE,
  coupon_id     UUID NOT NULL REFERENCES bms_coupons(id) ON DELETE CASCADE,
  source        TEXT NOT NULL DEFAULT 'MANUAL_CHAT',
  assigned_by   TEXT,
  note          TEXT,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, customer_id, coupon_id)
);

CREATE INDEX IF NOT EXISTS idx_bms_customer_coupon_wallet_customer
  ON bms_customer_coupon_wallet(tenant_id, customer_id, revoked_at, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_bms_customer_coupon_wallet_coupon
  ON bms_customer_coupon_wallet(tenant_id, coupon_id, revoked_at);

ALTER TABLE bms_customer_coupon_wallet ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_customer_coupon_wallet FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_customer_coupon_wallet_tenant_isolation ON bms_customer_coupon_wallet;
CREATE POLICY bms_customer_coupon_wallet_tenant_isolation ON bms_customer_coupon_wallet
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_customer_coupon_wallet TO bms_app;
