-- =============================================================
-- 7.21  BMS Coupons — โค้ดส่วนลด
-- -------------------------------------------------------------
-- coupon ใช้ตอนสร้างออร์เดอร์ (createOrder(), lib/bms/orders.ts) — 1 order
-- ใช้ได้ 1 โค้ด (ไม่ stack), snapshot ผลลัพธ์ลง bms_orders.discount_amount/
-- coupon_code ตอนสร้างเลย (เหมือน unit_price snapshot ของ order_items) เพื่อให้
-- ยอดเงินอ้างอิงย้อนหลังได้แม้ coupon จะถูกลบ/แก้ค่าไปแล้ว
--
-- v1 ตั้งใจไม่ทำ:
--   - จำกัดโค้ดต่อสินค้า/หมวดหมู่ (ใช้ได้กับทั้งออร์เดอร์เท่านั้น)
--   - คืน redemptions_count ตอน order ถูก cancel/return (นับตอนสร้างออร์เดอร์
--     ครั้งเดียว ไม่ปล่อยคืนแม้ order จะถูกยกเลิกทีหลัง — อนุรักษ์ไว้ ป้องกันการ
--     สร้าง-ยกเลิก-สร้างใหม่ วนใช้โค้ดเดิมซ้ำเกิน max_redemptions)
--   - ตาราง redemption log แยก (เช็ค per_customer_limit จาก bms_orders.coupon_code
--     + customer_id ตรงๆ พอแล้ว ไม่ต้องมีตารางคู่ขนาน)
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_coupons (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  code                TEXT NOT NULL,                 -- เก็บเป็นตัวพิมพ์ใหญ่เสมอ (normalize ที่ service)
  type                TEXT NOT NULL CHECK (type IN ('PERCENT','FIXED')),
  value               NUMERIC(12,2) NOT NULL CHECK (value > 0),
  min_order_amount    NUMERIC(12,2),                 -- NULL = ไม่มีขั้นต่ำ
  max_redemptions     INTEGER,                       -- NULL = ไม่จำกัดจำนวนครั้งรวม
  redemptions_count   INTEGER NOT NULL DEFAULT 0,
  per_customer_limit  INTEGER,                       -- NULL = ไม่จำกัดต่อลูกค้า
  starts_at           TIMESTAMPTZ,                    -- NULL = ใช้ได้ทันที
  expires_at          TIMESTAMPTZ,                    -- NULL = ไม่มีวันหมดอายุ
  active              BOOLEAN NOT NULL DEFAULT true,
  note                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  CONSTRAINT chk_percent_max CHECK (type <> 'PERCENT' OR value <= 100)
);

CREATE INDEX IF NOT EXISTS idx_bms_coupons_tenant_active ON bms_coupons(tenant_id, active);

ALTER TABLE bms_orders
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coupon_code TEXT;

CREATE INDEX IF NOT EXISTS idx_bms_orders_coupon ON bms_orders(tenant_id, coupon_code) WHERE coupon_code IS NOT NULL;

-- ---- RLS (เหมือน 5.5/6.1) ----
ALTER TABLE bms_coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_coupons FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_coupons_tenant_isolation ON bms_coupons;
CREATE POLICY bms_coupons_tenant_isolation ON bms_coupons
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_coupons TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- ---- permission ใหม่: coupon.view / coupon.manage -------------
-- coupon กระทบราคา/margin โดยตรง → ให้ Manager + Administrator เท่านั้น
-- (Administrator เป็น super ในโค้ด ไม่ต้อง seed) ไม่ให้ Sales/Warehouse
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager','coupon.view'),
  ('Manager','coupon.manage')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
