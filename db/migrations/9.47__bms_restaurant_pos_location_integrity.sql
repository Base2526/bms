-- =============================================================
-- 9.47  Restaurant POS: enforce branch ownership through the floor
-- -------------------------------------------------------------
-- 9.44 tenant-scoped every FK, but an area, table and check from different
-- locations of the same tenant could still be linked. The service rejects
-- that shape; these composite keys make the database reject it as well.
-- =============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_restaurant_areas_tenant_location_id
  ON bms_restaurant_areas (tenant_id, location_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_restaurant_tables_tenant_location_id
  ON bms_restaurant_tables (tenant_id, location_id, id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_restaurant_tables_area_location_fk'
       AND conrelid = 'bms_restaurant_tables'::regclass
  ) THEN
    ALTER TABLE bms_restaurant_tables
      ADD CONSTRAINT bms_restaurant_tables_area_location_fk
      FOREIGN KEY (tenant_id, location_id, area_id)
      REFERENCES bms_restaurant_areas(tenant_id, location_id, id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_restaurant_checks_table_location_fk'
       AND conrelid = 'bms_restaurant_checks'::regclass
  ) THEN
    ALTER TABLE bms_restaurant_checks
      ADD CONSTRAINT bms_restaurant_checks_table_location_fk
      FOREIGN KEY (tenant_id, location_id, table_id)
      REFERENCES bms_restaurant_tables(tenant_id, location_id, id)
      NOT VALID;
  END IF;
END $$;

ALTER TABLE bms_restaurant_tables
  VALIDATE CONSTRAINT bms_restaurant_tables_area_location_fk;

ALTER TABLE bms_restaurant_checks
  VALIDATE CONSTRAINT bms_restaurant_checks_table_location_fk;

COMMENT ON CONSTRAINT bms_restaurant_tables_area_location_fk ON bms_restaurant_tables IS
  'A restaurant table and its area must belong to the same tenant location.';

COMMENT ON CONSTRAINT bms_restaurant_checks_table_location_fk ON bms_restaurant_checks IS
  'An open restaurant check and its table must belong to the same tenant location.';
