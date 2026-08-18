-- =============================================================
-- 8.2 — คืนสินค้าโดยไม่มีใบเสร็จ (blind return)
-- -------------------------------------------------------------
-- 7.91 ทำการคืนที่อ้างอิงบิลเดิมไว้ครบแล้ว แต่บังคับ orderId เสมอ ลูกค้าที่ทำ
-- ใบเสร็จหายจึงคืนไม่ได้เลยในระบบ และไม่มีทางให้ผู้จัดการ override
--
-- ทำไมเป็นตารางแยก ไม่ใช่ปล่อย bms_pos_returns.order_id ให้ NULL ได้:
--   • ความหมายต่างกัน — bms_pos_returns คือ "การคืนของบิลใบนั้น" ทุกแถวเชื่อมกลับ
--     ไปหาสินค้า ราคา ล็อต และการชำระเงินของจริง · blind return ไม่มีอะไรให้เชื่อม
--   • query รายงานการคืน 5 ตัวใน reports.ts join ผ่าน order ทั้งหมด การทำให้
--     คอลัมน์เป็น NULL ได้แปลว่าต้องไล่แก้ทุกตัวให้รองรับแถวที่ไม่มีบิล
--     ซึ่งคือการทำให้โค้ดที่ถูกอยู่แล้วซับซ้อนขึ้นเพื่อรองรับของที่คนละเรื่องกัน
--
-- ⚠️ นี่คือช่องทุจริตที่ตรงที่สุดของร้านค้าปลีก (เอาของที่ไม่ได้ซื้อมาคืนเอาเงิน)
-- จึงบังคับ: หัวหน้ากด PIN + เหตุผล + ราคาไม่เกินราคาขายปัจจุบัน
--
-- ⚠️ ภาษี: ไม่มีใบกำกับต้นทางให้อ้าง จึงออกใบลดหนี้ไม่ได้ — บันทึกนี้เป็นหลักฐาน
-- ภายในให้ฝ่ายบัญชีจัดการต่อ ไม่ใช่เอกสารภาษี
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_pos_blind_returns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id     UUID NOT NULL REFERENCES bms_locations(id),
  device_id       UUID NOT NULL REFERENCES bms_pos_devices(id),
  shift_id        UUID NOT NULL REFERENCES bms_pos_shifts(id) ON DELETE CASCADE,
  returned_by     UUID NOT NULL REFERENCES users(id),
  -- ต้องมีเสมอ ไม่ใช่ nullable เหมือน bms_pos_returns.approved_by
  approved_by     UUID NOT NULL REFERENCES users(id),
  reason          TEXT NOT NULL CHECK (btrim(reason) <> ''),
  -- ลูกค้าคนไหน (ถ้าระบุได้) — ช่วยให้เห็นคนที่มาคืนซ้ำ ๆ โดยไม่มีบิล
  customer_id     UUID REFERENCES bms_customers(id) ON DELETE SET NULL,
  customer_note   TEXT,
  refund_amount   NUMERIC(12,2) NOT NULL CHECK (refund_amount >= 0),
  idempotency_key TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS bms_pos_blind_return_items (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  blind_return_id UUID NOT NULL REFERENCES bms_pos_blind_returns(id) ON DELETE CASCADE,
  product_sku     TEXT NOT NULL,
  size            TEXT NOT NULL,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  -- ราคาที่คืนให้ต่อชิ้น · โค้ดบังคับว่าห้ามเกินราคาขายปัจจุบันของสินค้า
  unit_refund     NUMERIC(12,2) NOT NULL CHECK (unit_refund >= 0),
  FOREIGN KEY (tenant_id, product_sku) REFERENCES bms_products(tenant_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_bms_blind_returns_shift
  ON bms_pos_blind_returns (tenant_id, shift_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bms_blind_return_items_parent
  ON bms_pos_blind_return_items (tenant_id, blind_return_id);

-- ---- RLS + GRANT (copy 4.2 / 4.3) -----------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['bms_pos_blind_returns', 'bms_pos_blind_return_items'] LOOP
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
  bms_pos_blind_returns, bms_pos_blind_return_items TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- ---- permission ------------------------------------------------------
-- แยกจาก order.return โดยตั้งใจ: การคืนที่อ้างบิลได้เป็นงานหน้าเคาน์เตอร์ปกติ
-- ส่วนการคืนที่ไม่มีบิลคือการจ่ายเงินออกโดยเชื่อคำบอกเล่า — คนละระดับความไว้ใจ
INSERT INTO bms_role_permissions (tenant_id, role_id, permission)
SELECT t.id, r.id, 'pos.return.noreceipt'
FROM bms_tenants t
CROSS JOIN roles r
WHERE r.name = 'Manager'
ON CONFLICT (tenant_id, role_id, permission) DO NOTHING;
