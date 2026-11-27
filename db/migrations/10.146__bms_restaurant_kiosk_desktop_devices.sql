-- Desktop kiosk identity is distinct from the public ordering URL and POS devices.
-- One active device per branch is the assisted-pilot limit; a later multi-device
-- rollout must introduce its own revocation and URL policy.
CREATE TABLE IF NOT EXISTS bms_restaurant_kiosk_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL,
  label TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  credential_hash TEXT NOT NULL CHECK (length(credential_hash) = 64),
  pin_hash TEXT,
  pin_set_at TIMESTAMPTZ,
  pin_revision UUID NOT NULL DEFAULT gen_random_uuid(),
  pin_failures INTEGER NOT NULL DEFAULT 0 CHECK (pin_failures >= 0),
  pin_locked_until TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, location_id, id),
  UNIQUE (credential_hash),
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES bms_locations(tenant_id, id) ON DELETE CASCADE,
  CHECK ((active AND revoked_at IS NULL) OR (NOT active AND revoked_at IS NOT NULL)),
  CHECK ((pin_hash IS NULL) = (pin_set_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bms_restaurant_kiosk_devices_active_branch
  ON bms_restaurant_kiosk_devices (tenant_id, location_id) WHERE active;

ALTER TABLE bms_restaurant_kiosk_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_restaurant_kiosk_devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_restaurant_kiosk_devices_tenant_isolation ON bms_restaurant_kiosk_devices;
CREATE POLICY bms_restaurant_kiosk_devices_tenant_isolation ON bms_restaurant_kiosk_devices
  USING (
    tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid
    OR (active AND credential_hash = NULLIF(current_setting('bms.kiosk_device_hash', true), ''))
  )
  WITH CHECK (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON bms_restaurant_kiosk_devices TO bms_app;
SELECT public.create_revision_trigger('bms_restaurant_kiosk_devices');
-- Generic revisions include full OLD rows. Credential/PIN hashes must never
-- enter an audit/revision surface, so replace only this table's trigger.
CREATE OR REPLACE FUNCTION public.bms_kiosk_device_safe_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO bms_restaurant_kiosk_devices_revisions
    (tenant_id, editor_id, revision_id, snapshot)
  VALUES (OLD.tenant_id,
    NULLIF(current_setting('app.editor_id', true), '')::uuid,
    NULLIF(current_setting('app.revision_id', true), '')::uuid,
    to_jsonb(OLD) - 'credential_hash' - 'pin_hash');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bms_restaurant_kiosk_devices_rev_trg ON bms_restaurant_kiosk_devices;
CREATE TRIGGER bms_restaurant_kiosk_devices_rev_trg
  BEFORE UPDATE ON bms_restaurant_kiosk_devices
  FOR EACH ROW EXECUTE FUNCTION public.bms_kiosk_device_safe_revision();
DROP POLICY IF EXISTS bms_restaurant_kiosk_devices_revisions_tenant_isolation
  ON bms_restaurant_kiosk_devices_revisions;
CREATE POLICY bms_restaurant_kiosk_devices_revisions_tenant_isolation
  ON bms_restaurant_kiosk_devices_revisions
  USING (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid);
COMMENT ON TABLE bms_restaurant_kiosk_devices IS
  'Branch-bound Desktop Kiosk maintenance identities. The credential cannot submit or accept food orders.';

-- Rollback after disabling Desktop Kiosk device routes: revoke grants, drop the
-- revision trigger, policy, index and table. Keep the kiosk submissions/checks.
