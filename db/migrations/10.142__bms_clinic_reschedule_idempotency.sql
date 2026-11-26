-- 10.142: retain clinic reschedule command identity so delayed retries cannot undo newer moves.
BEGIN;
CREATE TABLE IF NOT EXISTS bms_clinic_appointment_reschedules (
  tenant_id uuid NOT NULL REFERENCES bms_tenants(id),
  appointment_id uuid NOT NULL,
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 8 AND 160),
  request_hash text NOT NULL CHECK (length(request_hash)=64),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,request_key),
  FOREIGN KEY (tenant_id,appointment_id) REFERENCES bms_clinic_appointments(tenant_id,id),
  FOREIGN KEY (tenant_id,requested_by) REFERENCES users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS bms_clinic_appointment_reschedules_appointment_idx
  ON bms_clinic_appointment_reschedules(tenant_id,appointment_id,requested_at DESC);
ALTER TABLE bms_clinic_appointment_reschedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_clinic_appointment_reschedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clinic_tenant ON bms_clinic_appointment_reschedules;
CREATE POLICY clinic_tenant ON bms_clinic_appointment_reschedules
  USING (tenant_id=nullif(current_setting('bms.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=nullif(current_setting('bms.tenant_id',true),'')::uuid);
GRANT SELECT, INSERT ON bms_clinic_appointment_reschedules TO bms_app;
COMMIT;

-- ROLLBACK: deploy the previous app; retain command rows for audit and later migration.
