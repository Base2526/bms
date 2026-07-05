-- =============================================================
-- 3.2  BMS products + inventory
-- -------------------------------------------------------------
-- ตาม BUSINESS_RULES.md:
--   • SKU unique, สินค้า inactive ขายไม่ได้, ราคาห้ามติดลบ
--   • Inventory = source of truth
--   • Available = Current - Reserved  (stock ห้ามติดลบ)
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_products (
  sku         TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  price       NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  keywords    TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bms_inventory (
  product_sku    TEXT NOT NULL REFERENCES bms_products(sku) ON DELETE CASCADE,
  size           TEXT NOT NULL,
  current_stock  INTEGER NOT NULL DEFAULT 0 CHECK (current_stock  >= 0),
  reserved_stock INTEGER NOT NULL DEFAULT 0 CHECK (reserved_stock >= 0),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_sku, size),
  CHECK (reserved_stock <= current_stock)
);

-- ค้นหาสินค้าจาก keyword (message ILIKE '%keyword%')
CREATE INDEX IF NOT EXISTS idx_bms_products_keywords ON bms_products USING GIN (keywords);

-- ---- Seed (ตรงกับ mock เดิม) --------------------------------
INSERT INTO bms_products (sku, name, active, price, keywords) VALUES
  ('NIKE-AIR',   'Nike Air',      TRUE, 3200, ARRAY['nike','ไนกี้','air']),
  ('ADIDAS-RUN', 'Adidas Runner', TRUE, 2900, ARRAY['adidas','อาดิดาส','runner','run'])
ON CONFLICT (sku) DO NOTHING;

INSERT INTO bms_inventory (product_sku, size, current_stock, reserved_stock) VALUES
  ('NIKE-AIR',   'S',   0, 0),
  ('NIKE-AIR',   'M',  12, 2),
  ('NIKE-AIR',   'L',   3, 0),
  ('NIKE-AIR',   'XL',  6, 1),   -- available = 5
  ('NIKE-AIR',   'XXL', 0, 0),
  ('ADIDAS-RUN', 'M',   8, 0),
  ('ADIDAS-RUN', 'L',   0, 0),
  ('ADIDAS-RUN', 'XL',  2, 0)
ON CONFLICT (product_sku, size) DO NOTHING;
