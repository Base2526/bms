-- =============================================================
-- 3.4  BMS IMS — barcode + reorder point + stock movement ledger
-- -------------------------------------------------------------
--   • barcode (unique) บน products
--   • reorder_point ต่อไซซ์ (แจ้งเตือนของใกล้หมด)
--   • bms_stock_movements = ประวัติการเคลื่อนไหวสต็อกทุก event
-- =============================================================

ALTER TABLE bms_products  ADD COLUMN IF NOT EXISTS barcode TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_products_barcode
  ON bms_products (barcode) WHERE barcode IS NOT NULL;

ALTER TABLE bms_inventory ADD COLUMN IF NOT EXISTS reorder_point INTEGER NOT NULL DEFAULT 0
  CHECK (reorder_point >= 0);

CREATE TABLE IF NOT EXISTS bms_stock_movements (
  id            BIGSERIAL PRIMARY KEY,
  product_sku   TEXT NOT NULL REFERENCES bms_products(sku),
  size          TEXT NOT NULL,
  type          TEXT NOT NULL
                  CHECK (type IN ('STOCK_IN','STOCK_OUT','RESERVE','RELEASE','FULFILL')),
  qty           INTEGER NOT NULL CHECK (qty > 0),   -- ปริมาณ (ค่าบวกเสมอ) ทิศทางดูจาก type
  ref_order_id  UUID REFERENCES bms_orders(id) ON DELETE SET NULL,
  note          TEXT,
  actor         TEXT,                               -- admin / system / customer:<ref>
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bms_movements_sku_size ON bms_stock_movements(product_sku, size, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bms_movements_order    ON bms_stock_movements(ref_order_id);
