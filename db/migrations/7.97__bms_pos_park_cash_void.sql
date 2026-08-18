-- =============================================================
-- 7.97 — พักบิล · เงินเข้า-ออกลิ้นชัก · ยกเลิกบิล (void)
-- -------------------------------------------------------------
-- สามเรื่องนี้อยู่ไฟล์เดียวกันเพราะทั้งหมดผูกกับ "กะ" ตัวเดียวกัน และต้อง
-- apply พร้อมกัน ไม่งั้นสูตรเงินที่ควรมีตอนปิดกะจะคิดจากข้อมูลครึ่งเดียว
--
-- 1. bms_pos_parked_sales   — ตะกร้าที่พักไว้ระหว่างรอลูกค้า
-- 2. bms_pos_cash_movements — เงินเข้า/ออกลิ้นชักที่ไม่ใช่การขาย
-- 3. void                   — ยกเลิกบิลที่กดผิด แยกจากการคืนสินค้า
-- =============================================================

-- ---- 1. พักบิล ------------------------------------------------------
-- ตะกร้าที่พักไว้ "ไม่จองสต็อก" โดยตั้งใจ — พักบิลคือการจำรายการให้พนักงาน
-- ไม่ใช่คำมั่นว่าจะมีของ ถ้าจองสต็อกแล้วลูกค้าไม่กลับมา ของจะถูกล็อกทิ้งไว้
-- จนกว่าจะมีคนไปล้างเอง (ในทางปฏิบัติคือไม่มีใครล้าง) · ของอาจหมดตอนเรียก
-- กลับมา ซึ่ง createOrder จะปฏิเสธเองอยู่แล้วด้วย INSUFFICIENT
CREATE TABLE IF NOT EXISTS bms_pos_parked_sales (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id     UUID NOT NULL REFERENCES bms_locations(id),
  device_id       UUID NOT NULL REFERENCES bms_pos_devices(id) ON DELETE CASCADE,
  -- ผูกกับกะ: ปิดกะแล้วบิลพักต้องหมดอายุไปด้วย ไม่ใช่ค้างข้ามวันจนสต็อก/ราคาเปลี่ยน
  shift_id        UUID NOT NULL REFERENCES bms_pos_shifts(id) ON DELETE CASCADE,
  parked_by       UUID NOT NULL REFERENCES users(id),
  -- ป้ายที่พนักงานตั้งเอง เช่น "ป้าแดง" / "ลูกค้าเสื้อฟ้า" — ต้องมี ไม่งั้นเรียกกลับผิดใบ
  label           TEXT NOT NULL CHECK (btrim(label) <> ''),
  -- ตะกร้า + บริบทของบิล (สมาชิก/คูปอง/แต้มที่ตั้งใจแลก) เก็บเป็น snapshot
  -- ราคาไม่ได้ถูกล็อก — ตอนเรียกกลับมาคิดราคาใหม่จาก catalog เสมอ
  cart            JSONB NOT NULL,
  item_count      INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  subtotal_hint   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal_hint >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bms_parked_sales_shift
  ON bms_pos_parked_sales (tenant_id, shift_id, created_at DESC);

-- ---- 2. เงินเข้า-ออกลิ้นชัก ------------------------------------------
-- ไม่มีตารางนี้ = ถอนเงินไปฝากธนาคารกลางกะ หรือจ่ายค่าน้ำแข็งจากลิ้นชัก แล้ว
-- ปิดกะขึ้นเงินขาดทุกครั้งโดยไม่มีที่ให้อธิบาย · reason บังคับกรอกเพราะรายการ
-- ที่ไม่มีเหตุผลกำกับเท่ากับไม่มีรายการในมุมของคนตรวจ
CREATE TABLE IF NOT EXISTS bms_pos_cash_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  shift_id        UUID NOT NULL REFERENCES bms_pos_shifts(id) ON DELETE CASCADE,
  device_id       UUID NOT NULL REFERENCES bms_pos_devices(id) ON DELETE CASCADE,
  direction       TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason          TEXT NOT NULL CHECK (btrim(reason) <> ''),
  -- คนทำกับคนอนุมัติแยกกัน: เงินออกจากลิ้นชักต้องมีคนที่สองเสมอ (บังคับในโค้ด)
  actor_user_id   UUID NOT NULL REFERENCES users(id),
  approved_by     UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bms_cash_movements_shift
  ON bms_pos_cash_movements (tenant_id, shift_id, created_at);

-- ---- 3. ยกเลิกบิล (void) --------------------------------------------
-- void ใช้เครื่องจักรคืนสินค้าตัวเดิมทั้งหมด (คืนสต็อก/ล็อต/แต้ม/เงิน) แต่ต้อง
-- แยกออกจากการคืนสินค้าจริงในรายงาน ไม่งั้นการกดผิดจะไปโผล่ในรายงานจับทุจริต
-- การคืน (pos-return-audit เตือนเมื่อแคชเชียร์คืน >= 5 ครั้ง) แล้วสัญญาณนั้นพัง
ALTER TABLE bms_pos_returns
  ADD COLUMN IF NOT EXISTS is_void BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN bms_pos_returns.is_void IS
  'TRUE = เกิดจากการยกเลิกบิลที่กดผิด ไม่ใช่ลูกค้าเอาของมาคืน — รายงานการคืนต้องกรองออก';

ALTER TABLE bms_orders
  ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by   UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_bms_orders_voided
  ON bms_orders (tenant_id, voided_at) WHERE voided_at IS NOT NULL;

-- ---- 4. RLS + GRANT (copy 4.2 / 4.3) --------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bms_pos_parked_sales',
    'bms_pos_cash_movements'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format($p$
      CREATE POLICY %I ON %I
        USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
        WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
    $p$, t || '_tenant_isolation', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  bms_pos_parked_sales,
  bms_pos_cash_movements
TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- ---- 5. permission ใหม่ + seed ทุกร้าน ------------------------------
-- ลืมข้อนี้ = ปุ่มใหม่โดน 403 เงียบ ๆ โดยไม่ logout (apollo errorLink เตะเฉพาะ 401)
--
-- pos.void และ pos.cash.movement ให้ Manager เท่านั้นโดยตั้งใจ ทั้งสองอย่างคือ
-- "เงินหายจากยอดขาย" กับ "เงินหายจากลิ้นชัก" ซึ่งเป็นสองช่องทุจริตคลาสสิกของ
-- ร้านค้าปลีก · แคชเชียร์ยังทำได้ แต่ต้องให้หัวหน้ากด PIN ตอนนั้น (แบบเดียวกับ
-- ส่วนลดหน้าร้าน) ร้านที่อยากให้แคชเชียร์ทำเองมอบสิทธิ์เพิ่มได้ที่ /admin/permissions
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager','pos.void'),
  ('Manager','pos.cash.movement'),
  ('Manager','pos.shift.report'),
  ('Sales','pos.shift.report'),
  ('Cashier','pos.shift.report')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
