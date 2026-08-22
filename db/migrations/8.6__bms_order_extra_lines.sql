-- =============================================================
-- 8.6 — รายการเก็บเงินที่ไม่ใช่สินค้าในคลัง (ค่าถุง ค่าบริการ ค่าห่อของขวัญ)
-- -------------------------------------------------------------
-- เดิมเก็บเงินอะไรที่ไม่ได้อยู่ใน bms_products ไม่ได้เลย ต้องไปสร้าง SKU ปลอมก่อน
-- ซึ่งทำให้คลังมีสินค้าที่ไม่มีตัวตนและรายงานสต็อกเพี้ยน
--
-- ทำไมเป็นตารางใหม่ ไม่ใช่แก้ bms_order_items:
--   ตารางนั้นมีข้อบังคับสามข้อที่ขัดกับรายการแบบนี้ทั้งหมด
--     UNIQUE (order_id, product_sku, size)                → บิลเดียวมีค่าบริการ 2 บรรทัดไม่ได้
--     FK (tenant_id, product_sku) → bms_products          → ต้องมี SKU จริงก่อน
--     FK (tenant_id, location_id, product_sku, size)
--                                → bms_inventory          → ต้องมีแถวสต็อกก่อน
--   การคลายทั้งสามข้อคือการทำให้ตารางที่ **ทุกช่องทางใช้ร่วมกัน** (POS, ออนไลน์, LINE,
--   TikTok, Lazada/Shopee) หลวมลง เพื่อรองรับของที่ไม่ใช่สินค้า ซึ่งแลกความเสี่ยง
--   ไม่คุ้มเลย · ค่าถุงไม่ใช่รายการสินค้าจริง ๆ มันเป็นค่าบริการที่แนบมากับบิล
--   ตารางแยกจึงตรงกับความหมายมากกว่า และไม่ต้องแตะเส้นทางที่ทำงานถูกอยู่แล้ว
--
-- ⚠️ รายการพวกนี้ **อยู่ในฐาน VAT** (ค่าบริการของผู้ประกอบการที่จด VAT ต้องเสีย VAT)
-- จึงต้องถูกส่งเข้า computeVat เหมือนบรรทัดสินค้า ไม่ใช่บวกท้ายยอดเฉย ๆ
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_order_extra_lines (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  order_id      UUID NOT NULL REFERENCES bms_orders(id) ON DELETE CASCADE,
  -- ข้อความที่พิมพ์บนใบเสร็จ เช่น "ค่าถุง" "ค่าห่อของขวัญ" — ลูกค้าต้องอ่านเข้าใจ
  label         TEXT NOT NULL CHECK (btrim(label) <> ''),
  qty           INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_amount   NUMERIC(12,2) NOT NULL CHECK (unit_amount >= 0),
  vat_category  TEXT NOT NULL DEFAULT 'V' CHECK (vat_category IN ('V','N','UNKNOWN')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bms_order_extra_lines_order
  ON bms_order_extra_lines (tenant_id, order_id);

COMMENT ON TABLE bms_order_extra_lines IS
  'ค่าบริการ/ค่าถุง ที่เก็บเงินบนบิลแต่ไม่ใช่สินค้าในคลัง — อยู่ในฐาน VAT (8.6)';

-- ---- RLS + GRANT (copy 4.2 / 4.3) -----------------------------------
ALTER TABLE bms_order_extra_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_order_extra_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_order_extra_lines_tenant_isolation ON bms_order_extra_lines;
CREATE POLICY bms_order_extra_lines_tenant_isolation ON bms_order_extra_lines
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_order_extra_lines TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- ---- permission ------------------------------------------------------
-- ใช้ pos.sell เดิม: การเก็บค่าถุง 3 บาทเป็นงานประจำของคนคิดเงิน ไม่ใช่สิทธิพิเศษ
-- และเงินที่เก็บเพิ่มเข้าลิ้นชักซึ่งถูกนับตอนปิดกะอยู่แล้ว · ป้ายรายการโผล่บนใบเสร็จ
-- ลูกค้าจึงเห็นทุกบรรทัดที่ถูกคิด ซึ่งเป็นการควบคุมที่ตรงกว่าการกั้นด้วยสิทธิ์
