BEGIN;

-- A composite SET NULL without a column list also clears tenant_id, which is
-- NOT NULL. Keep the tenant and mark only the branch attribution as unknown.
ALTER TABLE bms_inventory_demand_events
  DROP CONSTRAINT IF EXISTS bms_inventory_demand_events_location_fk;
ALTER TABLE bms_inventory_demand_events
  ADD CONSTRAINT bms_inventory_demand_events_location_fk
  FOREIGN KEY (tenant_id, location_id)
  REFERENCES bms_locations(tenant_id, id) ON DELETE SET NULL (location_id);

COMMIT;

-- ROLLBACK: replace the FK with ON DELETE RESTRICT; never clear tenant_id.
