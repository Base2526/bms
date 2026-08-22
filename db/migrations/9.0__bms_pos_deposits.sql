-- =============================================================
-- 9.0 — มัดจำ / ค้างชำระ (สั่งของ จ่ายบางส่วน มารับทีหลัง)
-- -------------------------------------------------------------
-- POS ปัจจุบันบังคับว่ายอดที่ชำระต้องเท่ายอดบิลพอดี ไม่งั้นตีตก PAYMENT_MISMATCH
-- แล้วยกเลิกบิลทิ้ง · กฎนั้นถูกต้องสำหรับ "การขายที่จบที่เคาน์เตอร์" และต้องไม่ถูก
-- คลาย เพราะมันคือสิ่งที่กันการเก็บเงินไม่ตรงกับที่ระบบคิด
--
-- มัดจำจึงเป็น "บิลอีกชนิด" ไม่ใช่การผ่อนปรนกฎเดิม:
--   • ของถูก "จอง" (reserved_stock) แต่ยังไม่ตัดออกจากคลัง — ลูกค้ายังไม่ได้ของ
--   • บิลค้างที่สถานะ PENDING พร้อมยอดที่จ่ายแล้วและยอดคงเหลือ
--   • ลูกค้ากลับมาจ่ายส่วนที่เหลือ → ตอนนั้นบิลจึงเดินเส้นทางปิดการขายตามปกติ
--     (ตัดสต็อก ออกใบกำกับ ให้แต้ม) ซึ่งเป็นเส้นทางเดิมที่ผ่านการทดสอบแล้วทั้งหมด
--
-- ⚠️ ของที่ถูกจองค้างนานคือของที่ขายให้คนอื่นไม่ได้ · จึงมีวันหมดอายุการจอง และมี
-- รายงานให้เห็นว่าอะไรค้างอยู่ — ไม่มีสองอย่างนี้ ร้านจะมีสต็อกที่ "มีอยู่แต่ขายไม่ได้"
-- เพิ่มขึ้นเรื่อย ๆ โดยไม่มีใครรู้
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_pos_deposits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL REFERENCES bms_orders(id) ON DELETE CASCADE,
  location_id     UUID NOT NULL REFERENCES bms_locations(id),
  device_id       UUID REFERENCES bms_pos_devices(id) ON DELETE SET NULL,
  -- กะที่รับมัดจำ · ยอดมัดจำเป็นเงินเข้าลิ้นชักของกะนั้น
  shift_id        UUID REFERENCES bms_pos_shifts(id) ON DELETE SET NULL,
  customer_id     UUID REFERENCES bms_customers(id) ON DELETE SET NULL,
  -- ชื่อ/เบอร์ที่พนักงานจดไว้ กรณีลูกค้าไม่ใช่สมาชิก
  customer_note   TEXT,
  total_amount    NUMERIC(12,2) NOT NULL CHECK (total_amount > 0),
  deposit_paid    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (deposit_paid >= 0),
  status          TEXT NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN','COMPLETED','CANCELLED','FORFEITED')),
  -- วันที่ต้องมารับ · เลยกำหนดแล้วร้านตัดสินใจได้ว่าคืนมัดจำหรือยึด (FORFEITED)
  due_at          TIMESTAMPTZ,
  created_by      UUID NOT NULL REFERENCES users(id),
  completed_at    TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  cancelled_by    UUID REFERENCES users(id),
  cancel_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- บิลหนึ่งใบมีมัดจำได้ใบเดียว
  UNIQUE (tenant_id, order_id),
  CHECK (deposit_paid <= total_amount)
);

CREATE INDEX IF NOT EXISTS idx_bms_deposits_open
  ON bms_pos_deposits (tenant_id, status, due_at) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_bms_deposits_customer
  ON bms_pos_deposits (tenant_id, customer_id) WHERE customer_id IS NOT NULL;

COMMENT ON TABLE bms_pos_deposits IS
  'บิลมัดจำ — ของถูกจองแต่ยังไม่ตัดสต็อก บิลค้างที่ PENDING จนลูกค้ามาจ่ายส่วนที่เหลือ (9.0)';

-- ---- RLS + GRANT (copy 4.2 / 4.3) -----------------------------------
ALTER TABLE bms_pos_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_pos_deposits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_pos_deposits_tenant_isolation ON bms_pos_deposits;
CREATE POLICY bms_pos_deposits_tenant_isolation ON bms_pos_deposits
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_pos_deposits TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- ---- permission ใหม่ + seed -----------------------------------------
-- .take    = รับมัดจำ (คนขายทำได้ — เป็นการรับเงิน)
-- .cancel  = ยกเลิก/ยึดมัดจำ (Manager — เป็นการตัดสินใจเรื่องเงินของลูกค้า)
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager','pos.deposit.take'),
  ('Manager','pos.deposit.cancel'),
  ('Sales','pos.deposit.take'),
  ('Cashier','pos.deposit.take')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
