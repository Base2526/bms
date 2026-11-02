-- 10.107 — Preserve lot identity through inter-branch stock transfers.
-- SEND snapshots and deducts source lots; RECEIVE recreates the good quantity at the destination.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_stock_transfer_items_tenant_id_id_key'
       AND conrelid = 'bms_stock_transfer_items'::regclass
  ) THEN
    ALTER TABLE bms_stock_transfer_items
      ADD CONSTRAINT bms_stock_transfer_items_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_inventory_lots_tenant_id_id_key'
       AND conrelid = 'bms_inventory_lots'::regclass
  ) THEN
    ALTER TABLE bms_inventory_lots
      ADD CONSTRAINT bms_inventory_lots_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS bms_stock_transfer_item_lots (
  id                  BIGSERIAL PRIMARY KEY,
  tenant_id           UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  transfer_item_id    BIGINT NOT NULL,
  source_lot_id       UUID NOT NULL,
  destination_lot_id  UUID,
  lot_no              TEXT NOT NULL,
  expiry_date         DATE,
  unit_cost           NUMERIC(12,2) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  supplier_id         UUID,
  qty                 INTEGER NOT NULL CHECK (qty > 0),
  received_qty        INTEGER CHECK (received_qty IS NULL OR received_qty >= 0),
  damaged_qty         INTEGER CHECK (damaged_qty IS NULL OR damaged_qty >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transfer_item_id, source_lot_id),
  FOREIGN KEY (tenant_id, transfer_item_id)
    REFERENCES bms_stock_transfer_items(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, source_lot_id)
    REFERENCES bms_inventory_lots(tenant_id, id),
  FOREIGN KEY (tenant_id, destination_lot_id)
    REFERENCES bms_inventory_lots(tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id)
    REFERENCES bms_suppliers(tenant_id, id) ON DELETE SET NULL (supplier_id),
  CHECK (received_qty IS NULL OR damaged_qty IS NULL OR received_qty + damaged_qty <= qty)
);

CREATE INDEX IF NOT EXISTS idx_bms_stock_transfer_item_lots_item
  ON bms_stock_transfer_item_lots (tenant_id, transfer_item_id);
CREATE INDEX IF NOT EXISTS idx_bms_stock_transfer_item_lots_source
  ON bms_stock_transfer_item_lots (tenant_id, source_lot_id);
CREATE INDEX IF NOT EXISTS idx_bms_stock_transfer_item_lots_destination
  ON bms_stock_transfer_item_lots (tenant_id, destination_lot_id)
  WHERE destination_lot_id IS NOT NULL;

ALTER TABLE bms_stock_transfer_item_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_stock_transfer_item_lots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_stock_transfer_item_lots_tenant_isolation
  ON bms_stock_transfer_item_lots;
CREATE POLICY bms_stock_transfer_item_lots_tenant_isolation
  ON bms_stock_transfer_item_lots
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_stock_transfer_item_lots TO bms_app;
GRANT USAGE, SELECT ON SEQUENCE bms_stock_transfer_item_lots_id_seq TO bms_app;

COMMENT ON TABLE bms_stock_transfer_item_lots IS
  'Immutable source-lot snapshot plus receipt allocation for an inter-branch transfer line.';

-- ROLLBACK (only before depending transfers exist):
-- DROP TABLE bms_stock_transfer_item_lots;
-- ALTER TABLE bms_inventory_lots DROP CONSTRAINT bms_inventory_lots_tenant_id_id_key;
-- ALTER TABLE bms_stock_transfer_items DROP CONSTRAINT bms_stock_transfer_items_tenant_id_id_key;
