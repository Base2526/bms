-- =============================================================
-- 8.7 — โปรโมชันต่อสินค้า: ซื้อ X แถม Y / N ชิ้น ราคาเดียว
-- -------------------------------------------------------------
-- คูปอง (bms_coupons) เป็นส่วนลดที่ลูกค้าต้องรู้โค้ด · ขั้นราคาส่ง (8.1) เป็นราคา
-- ต่อหน่วยตามจำนวน · ไม่มีอันไหนตอบ "ซื้อ 3 แถม 1" หรือ "3 ชิ้น 100 บาท" ซึ่งเป็น
-- โปรที่ร้านค้าปลีกไทยใช้มากที่สุด
--
-- ⚠️ การตัดสินใจที่สำคัญที่สุดของไฟล์นี้: **โปรโมชันไม่ใช่ "ส่วนลดชั้นที่ 5"**
--
-- ระบบมีส่วนลด 4 ชั้นแล้ว (tier → คูปอง → แต้ม → ส่วนลดมือ) ที่ถูกบังคับเพดานรวม
-- ต่อบิล (max_discount_pct) · ถ้าเอาโปรไปเป็นชั้นที่ 5 จะเกิดสองปัญหาทันที
--   1. โปรที่ร้านประกาศไว้หน้าร้านอาจถูก "ตัด" เพราะบิลนั้นชนเพดาน — ร้านผิดคำพูด
--      กับลูกค้าเพราะกฎภายในของตัวเอง ซึ่งอธิบายที่เคาน์เตอร์ไม่ได้เลย
--   2. บรรทัดบนใบเสร็จจะแสดงราคาเต็มแล้วมีส่วนลดก้อนใหญ่ท้ายบิล ทั้งที่ลูกค้าเข้าใจว่า
--      "3 ชิ้น 100" คือราคาของของสามชิ้นนั้น
--
-- จึงทำเป็นกลไกราคาต่อบรรทัดแบบเดียวกับ 8.1 — คิดจากจำนวนรวมของ SKU นั้นในบิล
-- แล้วออกมาเป็นราคาที่ลูกค้าเห็นตรง ๆ ไม่ผ่านเพดานส่วนลด
--
-- ขอบเขต v1: โปรที่เกิดภายในสินค้าตัวเดียวกันเท่านั้น
-- "ซื้อ A แถม B" (ข้ามสินค้า) ยังไม่รองรับ — ดู docs/business/pos.md
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_product_promotions (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  product_sku   TEXT NOT NULL,
  -- BUY_X_GET_Y  : ซื้อครบ buy_qty จ่ายเท่าเดิม ได้เพิ่ม get_qty ฟรี
  -- N_FOR_PRICE  : ทุก buy_qty ชิ้น คิดรวม bundle_price
  kind          TEXT NOT NULL CHECK (kind IN ('BUY_X_GET_Y','N_FOR_PRICE')),
  buy_qty       INTEGER NOT NULL CHECK (buy_qty >= 1),
  get_qty       INTEGER CHECK (get_qty IS NULL OR get_qty >= 1),
  bundle_price  NUMERIC(12,2) CHECK (bundle_price IS NULL OR bundle_price >= 0),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  -- ช่วงเวลาโปร · NULL = ไม่จำกัด · โปรค้างเป็นเหตุที่ร้านขายขาดทุนต่อโดยไม่รู้ตัว
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- สินค้าหนึ่งตัวมีโปรที่ใช้งานอยู่ได้ทีละหนึ่งแบบ — สองโปรบนสินค้าเดียวกันทำให้
  -- ต้องตอบว่า "อันไหนชนะ" ซึ่งไม่มีคำตอบที่พนักงานอธิบายลูกค้าได้
  FOREIGN KEY (tenant_id, product_sku) REFERENCES bms_products(tenant_id, sku) ON DELETE CASCADE,
  CHECK (
    (kind = 'BUY_X_GET_Y' AND get_qty IS NOT NULL AND bundle_price IS NULL) OR
    (kind = 'N_FOR_PRICE' AND bundle_price IS NOT NULL AND get_qty IS NULL)
  ),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

-- โปรที่ active ได้แถวเดียวต่อสินค้า (partial unique)
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_promotions_active_sku
  ON bms_product_promotions (tenant_id, product_sku) WHERE active;

CREATE INDEX IF NOT EXISTS idx_bms_promotions_sku
  ON bms_product_promotions (tenant_id, product_sku, active);

COMMENT ON TABLE bms_product_promotions IS
  'ซื้อ X แถม Y / N ชิ้นราคาเดียว — เป็นกลไกราคาต่อบรรทัด ไม่ใช่ส่วนลดที่อยู่ใต้เพดาน max_discount_pct (8.7)';

-- ---- RLS + GRANT (copy 4.2 / 4.3) -----------------------------------
ALTER TABLE bms_product_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_product_promotions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_product_promotions_tenant_isolation ON bms_product_promotions;
CREATE POLICY bms_product_promotions_tenant_isolation ON bms_product_promotions
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_product_promotions TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;

-- ---- permission ------------------------------------------------------
-- ใช้ product.edit เดิม: การตั้งโปรคือการตั้งราคาขายของสินค้านั้น
