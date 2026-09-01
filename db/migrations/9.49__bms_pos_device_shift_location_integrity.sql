-- =============================================================
-- 9.49  POS: enforce tenant/location through device and shift
-- -------------------------------------------------------------
-- Legacy POS FKs referenced UUID ids alone. Service code already derives the
-- branch from the device; these composite FKs make corrupt cross-tenant or
-- cross-branch device/shift/check links impossible in the database as well.
-- =============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_pos_devices_tenant_location_id
  ON bms_pos_devices (tenant_id, location_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_pos_shifts_tenant_location_device_id
  ON bms_pos_shifts (tenant_id, location_id, device_id, id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_pos_devices_tenant_location_fk'
       AND conrelid = 'bms_pos_devices'::regclass
  ) THEN
    ALTER TABLE bms_pos_devices
      ADD CONSTRAINT bms_pos_devices_tenant_location_fk
      FOREIGN KEY (tenant_id, location_id)
      REFERENCES bms_locations(tenant_id, id)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_pos_shifts_device_location_fk'
       AND conrelid = 'bms_pos_shifts'::regclass
  ) THEN
    ALTER TABLE bms_pos_shifts
      ADD CONSTRAINT bms_pos_shifts_device_location_fk
      FOREIGN KEY (tenant_id, location_id, device_id)
      REFERENCES bms_pos_devices(tenant_id, location_id, id)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bms_restaurant_checks_shift_device_location_fk'
       AND conrelid = 'bms_restaurant_checks'::regclass
  ) THEN
    ALTER TABLE bms_restaurant_checks
      ADD CONSTRAINT bms_restaurant_checks_shift_device_location_fk
      FOREIGN KEY (tenant_id, location_id, pos_device_id, pos_shift_id)
      REFERENCES bms_pos_shifts(tenant_id, location_id, device_id, id)
      NOT VALID;
  END IF;
END $$;

ALTER TABLE bms_pos_devices
  VALIDATE CONSTRAINT bms_pos_devices_tenant_location_fk;

ALTER TABLE bms_pos_shifts
  VALIDATE CONSTRAINT bms_pos_shifts_device_location_fk;

ALTER TABLE bms_restaurant_checks
  VALIDATE CONSTRAINT bms_restaurant_checks_shift_device_location_fk;
