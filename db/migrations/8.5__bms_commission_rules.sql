-- =============================================================
-- 8.5 — ค่าคอมมิชชันพนักงานขาย
-- -------------------------------------------------------------
-- ระบบรู้อยู่แล้วว่าใครขายบิลไหน (bms_orders.cashier_user_id ตั้งแต่ 7.87) แต่ไม่มี
-- ที่เก็บ "อัตราคอม" จึงคำนวณไม่ได้ ร้านที่จ่ายคอมต้องไปทำนอกระบบทั้งหมด
--
-- ⚠️ กับดักที่ตารางนี้ถูกออกแบบมาเพื่อเลี่ยง: **อัตราคอมเปลี่ยนได้**
--
-- ถ้าเก็บอัตราเดียวต่อร้านแล้วรายงานคำนวณด้วยอัตรา "ปัจจุบัน" เสมอ วันที่ร้านขึ้น
-- อัตราจาก 2% เป็น 3% ยอดคอมของเดือนที่จ่ายไปแล้วจะเปลี่ยนย้อนหลังทันที
-- พนักงานเปิดดูแล้วเห็นเลขไม่ตรงกับสลิปที่ได้รับ — ไม่มีทางอธิบายและไม่มีทางตรวจ
--
-- จึงเก็บเป็น "กฎที่มีวันเริ่มใช้" (effective_from) แล้วรายงานเลือกกฎที่มีผล
-- ณ วันที่ของบิลนั้น ๆ · แก้อัตราคือเพิ่มแถวใหม่ ไม่ใช่ทับแถวเดิม
-- ประวัติจึงคงที่ตลอดไปโดยไม่ต้องเก็บยอดคอมไว้ในตารางออร์เดอร์
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_commission_rules (
  id             BIGSERIAL PRIMARY KEY,
  tenant_id      UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  -- DEFAULT = ทุกสินค้า · PRODUCT = เจาะจง sku · CATEGORY = ตามหมวด
  -- เจาะจงกว่าชนะกว้างกว่า: PRODUCT > CATEGORY > DEFAULT
  scope          TEXT NOT NULL CHECK (scope IN ('DEFAULT','PRODUCT','CATEGORY')),
  -- sku หรือชื่อหมวด ตาม scope · DEFAULT ต้องเป็น NULL
  ref            TEXT,
  percent        NUMERIC(6,3) NOT NULL CHECK (percent >= 0 AND percent <= 100),
  effective_from DATE NOT NULL,
  note           TEXT,
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- กฎเดียวกันมีได้แถวเดียวต่อวันเริ่มใช้ · ตั้งซ้ำวันเดิมคือแก้อัตราของวันนั้น
  UNIQUE (tenant_id, scope, ref, effective_from),
  CHECK ((scope = 'DEFAULT' AND ref IS NULL) OR (scope <> 'DEFAULT' AND btrim(ref) <> ''))
);

CREATE INDEX IF NOT EXISTS idx_bms_commission_rules_lookup
  ON bms_commission_rules (tenant_id, scope, ref, effective_from DESC);

COMMENT ON TABLE bms_commission_rules IS
  'อัตราคอมแบบมีวันเริ่มใช้ — รายงานใช้กฎที่มีผล ณ วันที่ของบิล ไม่ใช่อัตราปัจจุบัน (8.5)';

-- ---- RLS + GRANT (copy 4.2 / 4.3) -----------------------------------
ALTER TABLE bms_commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_commission_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_commission_rules_tenant_isolation ON bms_commission_rules;
CREATE POLICY bms_commission_rules_tenant_isolation ON bms_commission_rules
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_commission_rules TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- ---- permission ใหม่ + seed -----------------------------------------
-- .view แยกจาก .manage: หัวหน้าทีมควรดูยอดคอมของทีมได้โดยไม่ต้องแก้อัตราได้
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, p.permission
FROM bms_tenants t
CROSS JOIN roles r
JOIN (VALUES
  ('Manager','commission.view'),
  ('Manager','commission.manage')
) AS p(role_name, permission) ON p.role_name = r.name
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
