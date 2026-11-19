BEGIN;
CREATE TABLE IF NOT EXISTS bms_factory_machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
  location_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, location_id, code),
  FOREIGN KEY (tenant_id, location_id) REFERENCES bms_locations(tenant_id, id)
);
ALTER TABLE bms_factory_machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_factory_machines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms_factory_machines;
CREATE POLICY tenant_isolation ON bms_factory_machines
  USING (tenant_id=nullif(current_setting('bms.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=nullif(current_setting('bms.tenant_id',true),'')::uuid);
GRANT SELECT, INSERT ON bms_factory_machines TO bms_app;
GRANT UPDATE(name,active,version,updated_at) ON bms_factory_machines TO bms_app;
ALTER TABLE bms_operation_production ADD COLUMN IF NOT EXISTS machine_id uuid;
ALTER TABLE bms_operation_production ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE bms_operation_production ADD COLUMN IF NOT EXISTS ended_at timestamptz;
ALTER TABLE bms_operation_production ADD COLUMN IF NOT EXISTS rejected_qty integer;
ALTER TABLE bms_operation_production ADD COLUMN IF NOT EXISTS labor_minutes integer;
ALTER TABLE bms_operation_production ADD COLUMN IF NOT EXISTS energy_kwh numeric(12,3);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='bms_operation_production'::regclass AND conname='bms_operation_production_machine_fk') THEN
    ALTER TABLE bms_operation_production ADD CONSTRAINT bms_operation_production_machine_fk
      FOREIGN KEY (tenant_id, machine_id) REFERENCES bms_factory_machines(tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='bms_operation_production'::regclass AND conname='bms_operation_production_factory_metrics_check') THEN
    ALTER TABLE bms_operation_production ADD CONSTRAINT bms_operation_production_factory_metrics_check
      CHECK (
        ((started_at IS NULL AND ended_at IS NULL) OR
         (started_at IS NOT NULL AND ended_at IS NOT NULL AND ended_at>=started_at))
        AND (rejected_qty IS NULL OR rejected_qty>=0)
        AND (labor_minutes IS NULL OR labor_minutes>=0)
        AND (energy_kwh IS NULL OR energy_kwh>=0)
      );
  END IF;
END $$;
GRANT UPDATE(started_at,ended_at,rejected_qty,labor_minutes,energy_kwh)
  ON bms_operation_production TO bms_app;
COMMIT;
-- ROLLBACK: keep machine and run evidence. Reverting the app is safe only after
-- stopping new machine-linked production commands; do not erase posted history.
