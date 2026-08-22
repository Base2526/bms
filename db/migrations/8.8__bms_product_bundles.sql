-- =============================================================
-- 8.8 — สินค้าชุด (bundle / kit): ขาย 1 ตัดสต็อกหลายตัว
-- -------------------------------------------------------------
-- เช่น "เซ็ตของขวัญ" = สบู่ 1 + โลชั่น 1 + ถุงผ้า 1 · ลูกค้าซื้อ "เซ็ต" หนึ่งชิ้น
-- แต่ของที่ออกจากคลังคือสามรายการ
--
-- ⚠️ ปัญหาโครงสร้างที่ต้องตัดสินใจ: bms_order_items มี FK ไป bms_inventory
--    ทุกบรรทัดจึงต้องมีแถวสต็อกอยู่จริง แต่ "เซ็ต" ไม่ได้ถูกนับเป็นสต็อกของตัวเอง
--
-- ทางที่เลือก: เซ็ตมีแถว bms_inventory ของตัวเองที่ค้างอยู่ที่ 0 ตลอด และขั้นตอน
-- จองสต็อกข้ามบรรทัดที่เป็นเซ็ตไป (ไปจองที่ส่วนประกอบแทน)
--   • ใบเสร็จยังแสดงชื่อ "เซ็ตของขวัญ" ซึ่งเป็นสิ่งที่ลูกค้าซื้อจริง — ถ้าไปบันทึกเป็น
--     สามบรรทัดของส่วนประกอบ ใบเสร็จจะไม่ตรงกับที่ลูกค้าเข้าใจและราคาก็อธิบายไม่ได้
--   • ไม่ต้องคลาย FK บนตารางที่ทุกช่องทางใช้ร่วมกัน (เหตุผลเดียวกับ 8.6)
--   • สต็อกของเซ็ตที่เป็น 0 ตลอดคือความจริง ไม่ใช่การหลอก — จำนวนที่ขายได้มาจาก
--     ส่วนประกอบ ไม่ใช่จากตัวมันเอง
--
-- ราคาใช้ราคาของเซ็ตเอง (bms_products.price ของ bundle_sku) ซึ่งคือเหตุผลที่ร้าน
-- ทำเซ็ต — ถูกกว่าซื้อแยก
-- =============================================================

ALTER TABLE bms_products
  ADD COLUMN IF NOT EXISTS is_bundle BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN bms_products.is_bundle IS
  'TRUE = สินค้าชุด ไม่มีสต็อกของตัวเอง ตัดจากส่วนประกอบใน bms_product_bundle_items (8.8)';

CREATE TABLE IF NOT EXISTS bms_product_bundle_items (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  bundle_sku      TEXT NOT NULL,
  component_sku   TEXT NOT NULL,
  component_size  TEXT NOT NULL,
  -- ต่อ 1 เซ็ต ใช้ส่วนประกอบนี้กี่หน่วยฐาน
  qty             INTEGER NOT NULL CHECK (qty > 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, bundle_sku, component_sku, component_size),
  FOREIGN KEY (tenant_id, bundle_sku)    REFERENCES bms_products(tenant_id, sku) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, component_sku) REFERENCES bms_products(tenant_id, sku),
  -- เซ็ตที่มีตัวเองเป็นส่วนประกอบจะวนไม่จบตอนขยาย
  CHECK (bundle_sku <> component_sku)
);

CREATE INDEX IF NOT EXISTS idx_bms_bundle_items_bundle
  ON bms_product_bundle_items (tenant_id, bundle_sku);
CREATE INDEX IF NOT EXISTS idx_bms_bundle_items_component
  ON bms_product_bundle_items (tenant_id, component_sku);

-- ---- RLS + GRANT (copy 4.2 / 4.3) -----------------------------------
ALTER TABLE bms_product_bundle_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_product_bundle_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_product_bundle_items_tenant_isolation ON bms_product_bundle_items;
CREATE POLICY bms_product_bundle_items_tenant_isolation ON bms_product_bundle_items
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_product_bundle_items TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- ---- permission ------------------------------------------------------
-- ใช้ product.edit เดิม: การประกอบเซ็ตคือการตั้งค่าสินค้า

-- ---- view: บรรทัดที่กระทบสต็อกจริง ---------------------------------
-- ทุกที่ที่ขยับสต็อกอ่านจาก bms_order_items ตรง ๆ อยู่ 3 แห่ง (ตัดสต็อกตอนจบบิล,
-- คืน reserved ตอนยกเลิก, ledger การเคลื่อนไหว) · ถ้าให้แต่ละที่ไป JOIN สูตรเซ็ตเอง
-- จะได้โค้ดสามชุดที่ต้องถูกต้องเท่ากันและจะค่อย ๆ เพี้ยนออกจากกัน
--
-- view นี้แปลงบรรทัดบิลเป็น "ของที่ขยับจริงในคลัง": บรรทัดปกติผ่านตามเดิม
-- บรรทัดที่เป็นเซ็ตถูกแทนด้วยส่วนประกอบ × จำนวนเซ็ต
--
-- ⚠️ ถ้าเพิ่มที่ที่ขยับสต็อกใหม่ ให้อ่านจาก view นี้ ไม่ใช่จาก bms_order_items
-- order_item_id ติดมาด้วย เพราะการตัดล็อต FEFO ต้องผูกล็อตกลับไปที่บรรทัดที่ขาย
-- (ส่วนประกอบของเซ็ตที่เป็นสินค้ามีล็อตต้องถูกตัดล็อตด้วย ไม่ใช่แค่ลดยอดสต็อก
--  ไม่งั้นยอดล็อตกับยอดสต็อกจะแยกกันเงียบ ๆ)
-- DROP ก่อน: CREATE OR REPLACE VIEW เปลี่ยน "ชื่อ" คอลัมน์ไม่ได้ ถึงจะเพิ่มท้ายก็ตาม
DROP VIEW IF EXISTS bms_order_stock_lines;
CREATE VIEW bms_order_stock_lines AS
  SELECT oi.id AS order_item_id, oi.tenant_id, oi.order_id, oi.location_id,
         oi.product_sku, oi.size, oi.qty
    FROM bms_order_items oi
    JOIN bms_products p
      ON p.tenant_id = oi.tenant_id AND p.sku = oi.product_sku
   WHERE p.is_bundle IS NOT TRUE
  UNION ALL
  SELECT oi.id, oi.tenant_id, oi.order_id, oi.location_id,
         b.component_sku, b.component_size, (oi.qty * b.qty)::integer
    FROM bms_order_items oi
    JOIN bms_products p
      ON p.tenant_id = oi.tenant_id AND p.sku = oi.product_sku AND p.is_bundle
    JOIN bms_product_bundle_items b
      ON b.tenant_id = oi.tenant_id AND b.bundle_sku = oi.product_sku;

GRANT SELECT ON bms_order_stock_lines TO bms_app;

COMMENT ON VIEW bms_order_stock_lines IS
  'บรรทัดบิลที่แปลงเป็นของที่ขยับจริงในคลัง — เซ็ตถูกแทนด้วยส่วนประกอบ (8.8) · ทุกที่ที่ขยับสต็อกต้องอ่านจากนี่';
