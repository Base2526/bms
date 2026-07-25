-- =============================================================
-- 7.23  bms_orders.coupon_id — ผูกออเดอร์กับคูปองด้วย id ที่นิ่ง
-- -------------------------------------------------------------
-- เดิมออเดอร์เก็บแค่ coupon_code (string) เป็น snapshot — แต่ code เปลี่ยนได้
-- (rename โค้ด) ทำให้:
--   1. "ใช้ไปแล้ว N" (redemptions_count ผูก coupon.id นิ่ง) ไม่ตรงกับประวัติการใช้
--      ที่ join ด้วย coupon_code ปัจจุบัน → count=1 แต่ประวัติว่าง
--   2. ออเดอร์อาจไปโผล่ผิดคูปองที่บังเอิญมาใช้ชื่อเก่าทีหลัง
-- แก้โดยเก็บ coupon_id (นิ่ง) ตอนสร้างออเดอร์ แล้ว join ประวัติด้วย id
--
-- coupon_code ยังเก็บไว้ (snapshot ชื่อ ณ ตอนสั่ง) เพื่อ display แม้คูปองถูกลบ
-- FK ON DELETE SET NULL: ลบคูปองไม่ลบออเดอร์ (แค่ตัด link, code snapshot ยังอยู่)
-- =============================================================

ALTER TABLE bms_orders
  ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES bms_coupons(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bms_orders_coupon_id
  ON bms_orders(tenant_id, coupon_id) WHERE coupon_id IS NOT NULL;

-- ไม่ backfill อัตโนมัติจาก coupon_code:
-- code ปัจจุบันชี้คูปองได้ตัวเดียว (UNIQUE tenant_id,code) แต่ถ้าคูปองถูก rename แล้ว
-- มีคูปองอื่นมาใช้ชื่อเก่า การ match ด้วย code จะผูกผิดตัว — ปล่อยออเดอร์เก่าเป็น
-- coupon_id NULL แล้วให้ query ประวัติ fallback ไป coupon_code สำหรับแถวเก่าแทน
-- (ออเดอร์ใหม่หลัง migration นี้จะเก็บ coupon_id ตรงเสมอ)
