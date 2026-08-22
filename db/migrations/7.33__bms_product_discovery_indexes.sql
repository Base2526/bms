-- =============================================================
-- 7.33  BMS product discovery indexes
-- -------------------------------------------------------------
-- Customer AI searches the active tenant catalog by name, SKU,
-- category, and brand and lists new arrivals by created_at.
-- Keep those reads bounded without adding a parallel search store.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE INDEX IF NOT EXISTS idx_bms_products_tenant_active_created
  ON bms_products(tenant_id, created_at DESC)
  WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_bms_products_name_trgm
  ON bms_products USING GIN (lower(name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_bms_products_sku_trgm
  ON bms_products USING GIN (lower(sku) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_bms_products_category_trgm
  ON bms_products USING GIN (lower(category) gin_trgm_ops)
  WHERE category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bms_products_brand_trgm
  ON bms_products USING GIN (lower(brand) gin_trgm_ops)
  WHERE brand IS NOT NULL;
