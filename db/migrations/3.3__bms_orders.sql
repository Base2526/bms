-- =============================================================
-- 3.3  BMS orders + order items (ผูกกับ reserve stock)
-- -------------------------------------------------------------
-- ตอนสร้าง order → reserve สต็อกทุกรายการในทรานแซกชันเดียว
-- status flow:  RESERVED → CONFIRMED → FULFILLED
--                       └→ CANCELLED (คืน reserved_stock)
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel       TEXT NOT NULL,                 -- line / tiktok / facebook / test
  customer_ref  TEXT,                          -- external user id (LINE userId ฯลฯ)
  status        TEXT NOT NULL DEFAULT 'RESERVED'
                  CHECK (status IN ('RESERVED','CONFIRMED','FULFILLED','CANCELLED')),
  total_amount  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bms_order_items (
  id           BIGSERIAL PRIMARY KEY,
  order_id     UUID NOT NULL REFERENCES bms_orders(id) ON DELETE CASCADE,
  product_sku  TEXT NOT NULL REFERENCES bms_products(sku),
  size         TEXT NOT NULL,
  qty          INTEGER NOT NULL CHECK (qty > 0),
  unit_price   NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),  -- snapshot ราคา ณ ตอนสั่ง
  FOREIGN KEY (product_sku, size) REFERENCES bms_inventory(product_sku, size),
  UNIQUE (order_id, product_sku, size)
);

CREATE INDEX IF NOT EXISTS idx_bms_order_items_order ON bms_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_bms_orders_customer   ON bms_orders(customer_ref);
