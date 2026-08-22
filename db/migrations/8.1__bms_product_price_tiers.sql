-- =============================================================
-- 8.1 — ราคาตามจำนวน (ซื้อเยอะได้ราคาส่ง)
-- -------------------------------------------------------------
-- ระบบมีกลไกราคาอยู่แล้ว 2 อัน แต่ไม่มีอันไหนตอบ "ซื้อครบ 10 ชิ้นได้ราคาส่ง":
--   • bms_product_packs (7.86) — ตั้งราคาต่อ "หน่วยขาย" เช่น ยกกล่อง 10 แผง ฿230
--     ตอบเรื่องบรรจุภัณฑ์ ไม่ใช่เรื่องจำนวน · ลูกค้าซื้อ 10 แผงแยกไม่ได้ราคากล่อง
--   • bms_membership_tiers (7.96) — ลด % ทั้งบิลตามชั้นสมาชิก ไม่ผูกกับสินค้า
--
-- ตารางนี้เติมช่องว่าง: ราคาต่อหน่วยฐานที่เปลี่ยนตามจำนวนที่ซื้อในบิลนั้น
--
-- ขอบเขตที่ตั้งใจให้แคบ (v1):
--   • คิดจากจำนวนรวมของ SKU นั้นทั้งบิล ไม่ใช่ต่อบรรทัด — "ซื้อครบ 10 ชิ้น" ในความ
--     เข้าใจของร้านหมายถึงรวมทุกไซซ์ ไม่ใช่ต้องเป็นไซซ์เดียวกัน 10 ชิ้น
--   • ถ้าบรรทัดนั้นขายเป็นหน่วยขาย (pack) ราคา pack ชนะเสมอ — pack คือการบอกตรง ๆ
--     ว่า "กล่องนี้ราคาเท่านี้" ให้สองกลไกแย่งกันตัดสินราคาจะอธิบายบิลไม่ได้
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_product_price_tiers (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  product_sku   TEXT NOT NULL,
  -- ซื้อครบกี่หน่วยฐานถึงได้ราคานี้ · ต้อง >= 2 เพราะ 1 ชิ้นคือราคาปกติที่ bms_products
  min_qty       INTEGER NOT NULL CHECK (min_qty >= 2),
  unit_price    NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_sku, min_qty),
  FOREIGN KEY (tenant_id, product_sku) REFERENCES bms_products(tenant_id, sku) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bms_price_tiers_sku
  ON bms_product_price_tiers (tenant_id, product_sku, min_qty);

COMMENT ON TABLE bms_product_price_tiers IS
  'ราคาต่อหน่วยฐานตามจำนวนที่ซื้อรวมทั้งบิล — ขั้นที่ min_qty สูงสุดที่ไม่เกินจำนวนที่ซื้อชนะ';

-- ---- RLS + GRANT (copy 4.2 / 4.3) -----------------------------------
ALTER TABLE bms_product_price_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_product_price_tiers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_product_price_tiers_tenant_isolation ON bms_product_price_tiers;
CREATE POLICY bms_product_price_tiers_tenant_isolation ON bms_product_price_tiers
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_product_price_tiers TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- ---- permission ------------------------------------------------------
-- ใช้ product.edit เดิม ไม่สร้างใหม่: การตั้งราคาส่งเป็นการแก้ราคาสินค้า
-- ซึ่งคนที่แก้ราคาปกติได้อยู่แล้วก็ควรตั้งได้ · ไม่มีอะไรให้ seed
