-- Atomic rollout: reruns must NOT grandfather shops created after the first run.
BEGIN;
ALTER TABLE bms_plans ADD COLUMN IF NOT EXISTS max_branches INTEGER NOT NULL DEFAULT -1 CHECK (max_branches >= -1);
ALTER TABLE bms_plans ADD COLUMN IF NOT EXISTS max_devices INTEGER NOT NULL DEFAULT -1 CHECK (max_devices >= -1);
UPDATE bms_plans SET max_branches = CASE code WHEN 'business' THEN 5 ELSE 1 END,
  max_devices = CASE code WHEN 'business' THEN 10 WHEN 'pro' THEN 3 ELSE 1 END,
  max_channels = CASE code WHEN 'business' THEN -1 WHEN 'pro' THEN 3 ELSE 1 END
WHERE code IN ('free','pro','business');
ALTER TABLE bms_tenants ADD COLUMN IF NOT EXISTS capacity_policy_version SMALLINT NOT NULL DEFAULT 1
  CHECK (capacity_policy_version IN (1,2));
ALTER TABLE bms_tenants ALTER COLUMN capacity_policy_version SET DEFAULT 2;
COMMENT ON COLUMN bms_tenants.capacity_policy_version IS
  '1 retains unlimited branch/device/channel registrations; 2 applies package limits only to new registrations. Independent of feature_policy_version.';

CREATE TABLE IF NOT EXISTS bms_package_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('BASELINE','SIGNUP','PLAN_CHANGE')),
  from_plan TEXT,
  to_plan TEXT NOT NULL,
  actor TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'PLAN_CHANGE' AND from_plan IS NOT NULL AND from_plan <> to_plan)
    OR (kind IN ('BASELINE','SIGNUP') AND from_plan IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS bms_package_events_cohort ON bms_package_events(tenant_id)
  WHERE kind IN ('BASELINE','SIGNUP');
CREATE INDEX IF NOT EXISTS bms_package_events_time ON bms_package_events(occurred_at,tenant_id);
CREATE INDEX IF NOT EXISTS bms_package_events_tenant ON bms_package_events(tenant_id,occurred_at);
ALTER TABLE bms_package_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bms_package_events;
CREATE POLICY tenant_isolation ON bms_package_events
  USING (tenant_id = NULLIF(current_setting('bms.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('bms.tenant_id',true),'')::uuid);
GRANT SELECT, INSERT ON bms_package_events TO bms_app;
REVOKE UPDATE, DELETE ON bms_package_events FROM bms_app;
-- Snapshot existing shops, not historic signups/conversions. No historical facts invented.
INSERT INTO bms_package_events(tenant_id,kind,to_plan)
  SELECT id,'BASELINE',plan FROM bms_tenants WHERE capacity_policy_version=1
  ON CONFLICT DO NOTHING;
COMMIT;
-- No resource rows, operational jobs, points, or existing feature grants are changed.
-- Rollback: revert application admission checks, KEEP columns/defaults and append-only history.
-- Never drop/recreate policy_version columns. No business-table triggers are installed.
