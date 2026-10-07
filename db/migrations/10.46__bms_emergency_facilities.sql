-- Optional shop-maintained emergency directory. No customer location is collected.
-- Depends on 9.37 (uq_bms_locations_tenant_id) and revision infrastructure.
-- ROLLBACK (export directory/history first):
-- DROP TABLE IF EXISTS bms_emergency_facilities_revisions;
-- DROP TABLE IF EXISTS bms_emergency_facilities;
CREATE TABLE IF NOT EXISTS bms_emergency_facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id UUID,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120 AND name !~ '[[:cntrl:]]'),
  emergency_phone TEXT NOT NULL CHECK (emergency_phone ~ '^[+0-9-]{1,30}$' AND emergency_phone ~ '[0-9]'),
  address TEXT CHECK (length(address) <= 500),
  map_url TEXT CHECK (length(map_url) <= 2048 AND map_url ~ '^https://[^[:space:]]+$'),
  has_24h_emergency BOOLEAN NOT NULL DEFAULT false,
  distance_km NUMERIC(6,2) CHECK (distance_km >= 0 AND distance_km < 10000),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, location_id) REFERENCES bms_locations(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_bms_emergency_facilities_reply
  ON bms_emergency_facilities (tenant_id, location_id, sort_order, distance_km)
  WHERE active AND has_24h_emergency;
ALTER TABLE bms_emergency_facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_emergency_facilities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_emergency_facilities_tenant_isolation ON bms_emergency_facilities;
CREATE POLICY bms_emergency_facilities_tenant_isolation ON bms_emergency_facilities
  USING (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON bms_emergency_facilities TO bms_app;
SELECT public.create_revision_trigger('bms_emergency_facilities');
COMMENT ON TABLE bms_emergency_facilities IS
  'Shop-maintained directory, not customer geolocation or guaranteed availability. Only active 24h emergency departments supplement fixed emergency copy.';
