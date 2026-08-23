-- =============================================================
-- 9.17 — ราคาส่งรวมข้ามไซซ์โดยรักษาสัดส่วนราคาแต่ละไซซ์
-- -------------------------------------------------------------
-- PER_VARIANT_FIXED: พฤติกรรมเดิม จำนวนและราคาคิดแยก SKU+size
-- CROSS_VARIANT_PERCENT: รวมจำนวนทุกไซซ์ของ SKU เพื่อผ่านขั้นต่ำ แล้วลด %
-- จากราคาฐานของแต่ละไซซ์ จึงไม่บีบสินค้าทุกไซซ์ให้เหลือราคาเดียวกัน
-- =============================================================

ALTER TABLE bms_product_price_tiers
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'PER_VARIANT_FIXED',
  ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(5,2);

ALTER TABLE bms_product_price_tiers
  ALTER COLUMN unit_price DROP NOT NULL;

ALTER TABLE bms_product_price_tiers
  DROP CONSTRAINT IF EXISTS bms_product_price_tiers_scope_check,
  DROP CONSTRAINT IF EXISTS bms_product_price_tiers_value_check;

ALTER TABLE bms_product_price_tiers
  ADD CONSTRAINT bms_product_price_tiers_scope_check
    CHECK (scope IN ('PER_VARIANT_FIXED', 'CROSS_VARIANT_PERCENT')),
  ADD CONSTRAINT bms_product_price_tiers_value_check CHECK (
    (scope = 'PER_VARIANT_FIXED' AND unit_price IS NOT NULL AND unit_price >= 0 AND discount_pct IS NULL)
    OR
    (scope = 'CROSS_VARIANT_PERCENT' AND unit_price IS NULL AND discount_pct > 0 AND discount_pct <= 100)
  );

COMMENT ON COLUMN bms_product_price_tiers.scope IS
  'PER_VARIANT_FIXED = แยกจำนวนต่อไซซ์และใช้ราคาคงที่; CROSS_VARIANT_PERCENT = รวมจำนวนข้ามไซซ์และลดจากราคาของแต่ละไซซ์';
COMMENT ON COLUMN bms_product_price_tiers.discount_pct IS
  'เปอร์เซ็นต์ลดเมื่อ scope=CROSS_VARIANT_PERCENT; null สำหรับราคาคงที่แบบเดิม';
