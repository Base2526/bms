BEGIN;
-- Current balances are derived state. An inventory row deleted with its product must not leave
-- a balance that can be inherited by a subsequently recreated SKU. Immutable evidence is retained.
DELETE FROM bms_inventory_values v WHERE NOT EXISTS (
  SELECT 1 FROM bms_inventory i WHERE i.tenant_id=v.tenant_id AND i.location_id=v.location_id
    AND i.product_sku=v.product_sku AND i.size=v.size
);
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='bms_inventory_values'::regclass
    AND conname='bms_inventory_values_stock_fk') THEN
    ALTER TABLE bms_inventory_values ADD CONSTRAINT bms_inventory_values_stock_fk
      FOREIGN KEY(tenant_id,location_id,product_sku,size)
      REFERENCES bms_inventory(tenant_id,location_id,product_sku,size) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS bms_inventory_value_period_idx ON bms_inventory_value_entries(tenant_id,created_at,kind);
COMMIT;
-- ROLLBACK: dropping this FK restores orphan-cache risk; retain all append-only valuation history.
