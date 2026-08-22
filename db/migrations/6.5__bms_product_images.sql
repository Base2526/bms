-- =============================================================
-- 6.5  BMS product gallery (multiple images per product)
-- -------------------------------------------------------------
-- • เพิ่มตาราง bms_product_images แยกจาก bms_products.image_url
-- • image_url เดิมยังคงเป็น "รูปหลัก/cover" เพื่อ backward compatibility
-- • รองรับหลายรูป + ลำดับการแสดงผล
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_product_images (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  product_sku TEXT NOT NULL,
  file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bms_product_images_product_fk
    FOREIGN KEY (tenant_id, product_sku) REFERENCES bms_products(tenant_id, sku) ON DELETE CASCADE,
  CONSTRAINT bms_product_images_unique_file_per_product UNIQUE (tenant_id, product_sku, file_id)
);

CREATE INDEX IF NOT EXISTS idx_bms_product_images_product
  ON bms_product_images (tenant_id, product_sku, sort_order, id);

CREATE INDEX IF NOT EXISTS idx_bms_product_images_file
  ON bms_product_images (file_id);

-- ---- RLS (เหมือน 4.2 / 6.0) ----
ALTER TABLE bms_product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_product_images FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_product_images_tenant_isolation ON bms_product_images;
CREATE POLICY bms_product_images_tenant_isolation ON bms_product_images
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

-- ---- GRANT ให้ bms_app (เหมือน 4.3) ----
GRANT SELECT, INSERT, UPDATE, DELETE ON bms_product_images TO bms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bms_app;
