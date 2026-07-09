-- =============================================================
-- 6.0  BMS Products — หมวดหมู่สินค้าเป็น list ที่จัดการได้ (ไม่ใช่พิมพ์อิสระ)
-- -------------------------------------------------------------
-- bms_products.category ยังเป็น TEXT เหมือนเดิม (ไม่ทำ FK บังคับ กัน data เดิมพัง) —
-- bms_product_categories เป็น "รายการหมวดหมู่ที่ร้านนิยาม" ให้เลือกจาก dropdown ในฟอร์มสินค้า +
-- มีหน้าจัดการ (เพิ่ม/แก้ชื่อ/ลบ) แยกจากการพิมพ์อิสระแบบเดิม
-- รันซ้ำได้ปลอดภัย
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_product_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_bms_product_categories_tenant ON bms_product_categories(tenant_id);

-- backfill: หมวดหมู่ที่เคยพิมพ์อิสระในสินค้าเดิม (ทุก tenant) → เข้า list ใหม่ ไม่ให้ข้อมูลเดิมหาย
INSERT INTO bms_product_categories (tenant_id, name)
SELECT DISTINCT tenant_id, category FROM bms_products
 WHERE category IS NOT NULL AND btrim(category) <> ''
ON CONFLICT (tenant_id, name) DO NOTHING;

-- ---- RLS (ตาข่ายชั้น 2 — เหมือน 4.2) ----
ALTER TABLE bms_product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_product_categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_product_categories_tenant_isolation ON bms_product_categories;
CREATE POLICY bms_product_categories_tenant_isolation ON bms_product_categories
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

-- ---- GRANT ให้ bms_app (เหมือน 4.3) ----
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_product_categories TO bms_app;
