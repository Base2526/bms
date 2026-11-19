-- Supplier packaging is evidence on a PO line. Inventory, lot and movement quantities
-- continue to use the integer base unit. Legacy PO lines remain base-unit lines.
ALTER TABLE bms_purchase_order_items
  ADD COLUMN IF NOT EXISTS supplier_unit_name TEXT,
  ADD COLUMN IF NOT EXISTS supplier_unit_qty_ordered INTEGER,
  ADD COLUMN IF NOT EXISTS base_qty_per_supplier_unit INTEGER,
  ADD COLUMN IF NOT EXISTS supplier_unit_evidence TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms_purchase_order_items'::regclass
       AND conname = 'bms_po_supplier_unit_snapshot_check'
  ) THEN
    ALTER TABLE bms_purchase_order_items
      ADD CONSTRAINT bms_po_supplier_unit_snapshot_check CHECK (
        (supplier_unit_name IS NULL AND supplier_unit_qty_ordered IS NULL
          AND base_qty_per_supplier_unit IS NULL AND supplier_unit_evidence IS NULL)
        OR
        (supplier_unit_name IS NOT NULL AND length(btrim(supplier_unit_name)) BETWEEN 1 AND 100
          AND supplier_unit_qty_ordered > 0 AND base_qty_per_supplier_unit > 1
          AND supplier_unit_qty_ordered::bigint * base_qty_per_supplier_unit = qty_ordered
          AND supplier_unit_evidence IS NOT NULL
          AND length(btrim(supplier_unit_evidence)) BETWEEN 1 AND 500)
      );
  END IF;
END $$;

COMMENT ON COLUMN bms_purchase_order_items.supplier_unit_qty_ordered IS
  'Supplier package count frozen on PO; multiply by base_qty_per_supplier_unit to obtain qty_ordered base units';
COMMENT ON COLUMN bms_purchase_order_items.base_qty_per_supplier_unit IS
  'Verified integer base-unit factor frozen on PO; receipt must reproduce it';
COMMENT ON COLUMN bms_purchase_order_items.supplier_unit_evidence IS
  'Staff-entered source reference for the verified conversion, not proof of supplier invoice or AP';

-- Existing bms_purchase_order_items RLS and bms_app table grants apply to these columns.
