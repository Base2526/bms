-- =============================================================
-- 8.0 — นับเงินปิดตา (blind close) + เปิดลิ้นชักโดยไม่ขาย (no-sale)
-- -------------------------------------------------------------
-- สองอย่างนี้คือการควบคุมภายในที่ผู้ตรวจสอบถามหา และ 7.97 ยังไม่ครอบคลุม
--
-- 1. blind close — คนนับต้องไม่เห็นยอดที่ "ควรมี" ก่อนกรอกยอดที่นับได้
--    ไม่งั้นกรอกให้ตรงได้เลย แล้ว variance เป็น 0 ตลอด ระบบจึงจับเงินขาดไม่ได้จริง
--    ค่าเริ่มต้นเปิดไว้ เพราะเป็นพฤติกรรมที่ถูกต้อง ร้านที่ไม่ต้องการค่อยปิดเอง
--
-- 2. no-sale — เปิดลิ้นชักเพื่อแลกแบงก์ย่อยให้ลูกค้าเป็นเรื่องปกติ
--    ห้ามไม่ได้ (พนักงานจะแอบเปิดด้วยมือแทน แล้วไม่มีร่องรอยเลย) แต่ต้องมีบันทึก
--    จำนวนครั้งที่เปิดโดยไม่ขายคือสัญญาณทุจริตคลาสสิกของร้านค้าปลีก
-- =============================================================

-- ---- 1. blind close --------------------------------------------------
ALTER TABLE bms_store_profile
  ADD COLUMN IF NOT EXISTS pos_blind_close BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN bms_store_profile.pos_blind_close IS
  'TRUE = ไม่แสดงยอดเงินที่ควรมีในลิ้นชักจนกว่าจะปิดกะแล้ว — คนนับกรอกให้ตรงไม่ได้';

-- ---- 2. no-sale ------------------------------------------------------
-- ไม่ใช้ bms_pos_cash_movements เพราะตารางนั้นบังคับ amount > 0 และความหมาย
-- ต่างกันจริง: no-sale คือ "เปิดลิ้นชักโดยเงินไม่ได้เข้าหรือออก"
-- ถ้ายัดรวมกัน ยอดเงินที่ควรมีตอนปิดกะจะคิดผิดทันทีที่มีคนเผลอใส่จำนวนเงิน
CREATE TABLE IF NOT EXISTS bms_pos_no_sales (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  shift_id        UUID NOT NULL REFERENCES bms_pos_shifts(id) ON DELETE CASCADE,
  device_id       UUID NOT NULL REFERENCES bms_pos_devices(id) ON DELETE CASCADE,
  actor_user_id   UUID NOT NULL REFERENCES users(id),
  reason          TEXT NOT NULL CHECK (btrim(reason) <> ''),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bms_no_sales_shift
  ON bms_pos_no_sales (tenant_id, shift_id, created_at);

-- ---- 3. RLS + GRANT (copy 4.2 / 4.3) --------------------------------
ALTER TABLE bms_pos_no_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_pos_no_sales FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_pos_no_sales_tenant_isolation ON bms_pos_no_sales;
CREATE POLICY bms_pos_no_sales_tenant_isolation ON bms_pos_no_sales
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_pos_no_sales TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- ---- 4. permission ใหม่ + seed ทุกร้าน ------------------------------
-- ให้ทุกคนที่ขายหน้าร้านได้ — การแลกเงินย่อยเป็นงานประจำ ไม่ใช่สิทธิพิเศษ
-- การควบคุมอยู่ที่ "มีบันทึกทุกครั้ง" ไม่ใช่ "ต้องขออนุญาต" · ถ้าบังคับขออนุญาต
-- พนักงานจะเปิดลิ้นชักด้วยมือแทนแล้วไม่เหลือร่องรอยอะไรเลย
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager','pos.nosale'),
  ('Sales','pos.nosale'),
  ('Cashier','pos.nosale')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
