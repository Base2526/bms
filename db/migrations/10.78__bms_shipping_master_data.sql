BEGIN;

-- Phase 3: carrier and Thai shipping-zone master data.
-- Global reference tables are read-only for bms_app; platform-admin writes use
-- the master-data service. Shop overrides are tenant-owned and protected by RLS.
-- ROLLBACK: switch application reads back to carriers/constants.ts and
-- shippingZones.ts, preserve shipment snapshot columns, then drop the override,
-- zone and carrier tables (plus their revision tables).

CREATE TABLE IF NOT EXISTS bms_master_carriers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  country_code CHAR(2) NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT NOT NULL,
  tracking_url_template TEXT,
  tracking_no_pattern TEXT,
  integration_status TEXT NOT NULL DEFAULT 'NONE'
    CHECK (integration_status IN ('LIVE','MOCK','NONE')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (code ~ '^[A-Z0-9_]{2,24}$'),
  CHECK (country_code ~ '^[A-Z]{2}$'),
  CHECK (name_th <> '' AND name_en <> ''),
  CHECK (tracking_url_template IS NULL OR (
    tracking_url_template LIKE 'https://%'
    AND tracking_url_template LIKE '%{trackingNo}%'
  )),
  CHECK (tracking_no_pattern IS NULL OR length(tracking_no_pattern) <= 200)
);

INSERT INTO bms_master_carriers
  (code,country_code,name_th,name_en,tracking_url_template,tracking_no_pattern,
   integration_status,source,source_version)
VALUES
  ('FLASH','TH','Flash','Flash',NULL,NULL,'MOCK','BMS carrier constants','pre-10.78'),
  ('KERRY','TH','Kerry','Kerry',NULL,NULL,'MOCK','BMS carrier constants','pre-10.78'),
  ('DHL','TH','DHL','DHL',NULL,NULL,'NONE','BMS carrier constants','pre-10.78'),
  ('AUSPOST','AU','Australia Post','Australia Post',NULL,NULL,'NONE','BMS carrier constants','pre-10.78'),
  ('NZPOST','NZ','NZ Post','NZ Post',NULL,NULL,'NONE','BMS carrier constants','pre-10.78'),
  ('OTHER','TH','อื่น ๆ','อื่น ๆ',NULL,NULL,'NONE','BMS carrier constants','pre-10.78')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS bms_master_th_shipping_zones (
  province_code TEXT PRIMARY KEY REFERENCES bms_master_th_provinces(code),
  zone TEXT NOT NULL CHECK (zone IN ('BANGKOK','PERIMETER','UPCOUNTRY')),
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Populate every province already imported by phase 1. The address importer also
-- performs this upsert so installs that import the 77 provinces later are complete.
INSERT INTO bms_master_th_shipping_zones (province_code,zone,source,source_version)
SELECT code,
       CASE
         WHEN name_th = 'กรุงเทพมหานคร' THEN 'BANGKOK'
         WHEN name_th IN ('นนทบุรี','ปทุมธานี','สมุทรปราการ','สมุทรสาคร','นครปฐม') THEN 'PERIMETER'
         ELSE 'UPCOUNTRY'
       END,
       'BMS legacy shipping-zone parity',
       'pre-10.78'
  FROM bms_master_th_provinces
ON CONFLICT (province_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS bms_shipping_zone_overrides (
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  province_code TEXT NOT NULL REFERENCES bms_master_th_provinces(code),
  zone TEXT NOT NULL CHECK (zone IN ('BANGKOK','PERIMETER','UPCOUNTRY')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, province_code)
);

CREATE INDEX IF NOT EXISTS idx_bms_shipping_zone_overrides_tenant
  ON bms_shipping_zone_overrides (tenant_id, province_code);

ALTER TABLE bms_shipping_zone_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_shipping_zone_overrides FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_shipping_zone_overrides_tenant_isolation ON bms_shipping_zone_overrides;
CREATE POLICY bms_shipping_zone_overrides_tenant_isolation ON bms_shipping_zone_overrides
  USING (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id))
  WITH CHECK (tenant_id = COALESCE(NULLIF(current_setting('bms.tenant_id', true), '')::uuid, tenant_id));

-- Snapshot carrier presentation on each shipment. An inactive or renamed master
-- row must never change an already-issued label or historical tracking link.
ALTER TABLE bms_shipments
  ADD COLUMN IF NOT EXISTS carrier_name TEXT,
  ADD COLUMN IF NOT EXISTS tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS tracking_no_warning TEXT;

UPDATE bms_shipments s
   SET carrier_name = c.name_th
  FROM bms_master_carriers c
 WHERE s.carrier = c.code AND s.carrier_name IS NULL;

SELECT public.create_revision_trigger('bms_master_carriers');
SELECT public.create_revision_trigger('bms_master_th_shipping_zones');
SELECT public.create_revision_trigger('bms_shipping_zone_overrides');

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['bms_master_carriers','bms_master_th_shipping_zones'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', tbl);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE %I FROM bms_app', tbl);
    EXECUTE format('GRANT SELECT ON TABLE %I TO bms_app', tbl);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', tbl || '_revisions');
    EXECUTE format('GRANT SELECT ON TABLE %I TO bms_app', tbl || '_revisions');
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON bms_shipping_zone_overrides TO bms_app;
GRANT SELECT ON bms_shipping_zone_overrides_revisions TO bms_app;

COMMENT ON TABLE bms_master_carriers IS 'Platform carrier directory. MOCK and NONE are never presented as connected.';
COMMENT ON TABLE bms_master_th_shipping_zones IS 'Default province-code shipping zone; populated with every imported Thai province.';
COMMENT ON TABLE bms_shipping_zone_overrides IS 'Tenant-specific province shipping-zone override; default remains in the global master table.';

COMMIT;
