-- =============================================================
-- 9.24  Mark authoritative sale-time pricing snapshots
-- -------------------------------------------------------------
-- 9.23 backfilled legacy rows from the rules visible at migration time.
-- That is useful support evidence, but it is not proof of the rules that were
-- active when an old bill was sold.  New orders write source=SALE atomically
-- with the order; only those rows may be repriced after a partial return.
-- =============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'bms_order_items_pricing_snapshot_source_check'
       AND conrelid = 'bms_order_items'::regclass
  ) THEN
    ALTER TABLE bms_order_items
      ADD CONSTRAINT bms_order_items_pricing_snapshot_source_check
      CHECK (
        NOT (pricing_snapshot ? 'source')
        OR pricing_snapshot ->> 'source' = 'SALE'
      );
  END IF;
END $$;

COMMENT ON COLUMN bms_order_items.pricing_snapshot IS
  'Wholesale/promotion evidence for POS returns; only JSON with source=SALE is an authoritative sale-time snapshot, while legacy rows without source keep proportional refunds';
