-- =============================================================
-- 7.26  Customer coupon wallet lifecycle
-- -------------------------------------------------------------
-- ยกระดับ wallet จาก assignment-only → มี lifecycle ต่อคนต่อคูปอง
-- โดยยังคงให้ bms_orders / createOrder() เป็น source of truth ด้าน redemption จริง
--
-- state:
--   ASSIGNED  = ร้านมอบสิทธิ์ให้แล้ว แต่ลูกค้ายังไม่ได้กดใช้
--   CLAIMED   = ลูกค้าบอกว่าจะใช้/กดใช้แล้ว แต่ยังไม่มี order lock
--   RESERVED  = มี order PENDING/PAID/... ที่ lock คูปองใบนี้อยู่
--   REDEEMED  = ใช้สำเร็จและ order ไปถึง paid path แล้ว
--   REVOKED   = ร้านถอนสิทธิ์
--   EXPIRED   = terminal state สำหรับ snapshot เมื่อมีการ sync หลังหมดอายุ
-- =============================================================

ALTER TABLE bms_customer_coupon_wallet
  ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'ASSIGNED',
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reserved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reserved_order_id UUID REFERENCES bms_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS redeemed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS redeemed_order_id UUID REFERENCES bms_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_bms_customer_coupon_wallet_state'
  ) THEN
    ALTER TABLE bms_customer_coupon_wallet
      ADD CONSTRAINT chk_bms_customer_coupon_wallet_state
      CHECK (state IN ('ASSIGNED','CLAIMED','RESERVED','REDEEMED','REVOKED','EXPIRED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bms_customer_coupon_wallet_state
  ON bms_customer_coupon_wallet(tenant_id, customer_id, state, assigned_at DESC);
