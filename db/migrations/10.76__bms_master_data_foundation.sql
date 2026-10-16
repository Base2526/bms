BEGIN;

-- Platform master data foundation (phase 1).
-- These tables are deliberately global: no tenant_id and no RLS. Tenant reads use
-- the bms_app SELECT grant; every write stays behind the platform-admin service.
-- ROLLBACK: revert application readers first. Preserve snapshots on tenant rows;
-- then DROP the four revision tables, four master tables, and nullable columns below.

CREATE TABLE IF NOT EXISTS bms_master_banks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  country_code CHAR(2) NOT NULL,
  name_th TEXT NOT NULL,
  name_en TEXT NOT NULL,
  swift TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (country_code, code),
  CHECK (country_code ~ '^[A-Z]{2}$'),
  CHECK (code <> '' AND name_th <> '' AND name_en <> ''),
  CHECK (swift IS NULL OR swift ~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$')
);

CREATE TABLE IF NOT EXISTS bms_master_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  country_code CHAR(2) NOT NULL DEFAULT 'TH',
  name_th TEXT NOT NULL,
  name_en TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  kind TEXT NOT NULL CHECK (kind IN ('COUNT','WEIGHT','VOLUME','LENGTH')),
  base_factor NUMERIC(24,9) NOT NULL DEFAULT 1 CHECK (base_factor > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (country_code ~ '^[A-Z]{2}$'),
  CHECK (code ~ '^[A-Z0-9]{1,3}$' AND name_th <> '' AND name_en <> '')
);

CREATE TABLE IF NOT EXISTS bms_master_th_provinces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  country_code CHAR(2) NOT NULL DEFAULT 'TH' CHECK (country_code = 'TH'),
  name_th TEXT NOT NULL,
  name_en TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (code <> '' AND name_th <> '' AND name_en <> '')
);

CREATE TABLE IF NOT EXISTS bms_master_th_districts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  country_code CHAR(2) NOT NULL DEFAULT 'TH' CHECK (country_code = 'TH'),
  province_code TEXT NOT NULL REFERENCES bms_master_th_provinces(code),
  name_th TEXT NOT NULL,
  name_en TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (province_code, code),
  CHECK (code <> '' AND name_th <> '' AND name_en <> '')
);

CREATE TABLE IF NOT EXISTS bms_master_th_subdistricts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  country_code CHAR(2) NOT NULL DEFAULT 'TH' CHECK (country_code = 'TH'),
  province_code TEXT NOT NULL REFERENCES bms_master_th_provinces(code),
  district_code TEXT NOT NULL REFERENCES bms_master_th_districts(code),
  name_th TEXT NOT NULL,
  name_en TEXT NOT NULL,
  postcode TEXT NOT NULL CHECK (postcode ~ '^[0-9]{5}$'),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (province_code, district_code)
    REFERENCES bms_master_th_districts(province_code, code),
  CHECK (code <> '' AND name_th <> '' AND name_en <> '')
);

CREATE INDEX IF NOT EXISTS idx_bms_master_banks_search
  ON bms_master_banks (country_code, active, sort_order, code);
CREATE INDEX IF NOT EXISTS idx_bms_master_units_search
  ON bms_master_units (active, kind, code);
CREATE INDEX IF NOT EXISTS idx_bms_master_th_districts_province
  ON bms_master_th_districts (province_code, active, name_th);
CREATE INDEX IF NOT EXISTS idx_bms_master_th_subdistricts_district
  ON bms_master_th_subdistricts (district_code, active, name_th);
CREATE INDEX IF NOT EXISTS idx_bms_master_th_subdistricts_postcode
  ON bms_master_th_subdistricts (postcode) WHERE active;

-- Snapshot links are optional so every pre-10.76 row keeps working unchanged.
ALTER TABLE bms_product_packs ADD COLUMN IF NOT EXISTS unit_code TEXT;
ALTER TABLE bms_order_items ADD COLUMN IF NOT EXISTS pack_unit_code TEXT;
ALTER TABLE bms_customer_addresses
  ADD COLUMN IF NOT EXISTS subdistrict_code TEXT,
  ADD COLUMN IF NOT EXISTS district_code TEXT,
  ADD COLUMN IF NOT EXISTS province_code TEXT;

-- These FKs validate new mappings without forcing old free-text rows to change.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_product_packs_unit_code_fkey') THEN
    ALTER TABLE bms_product_packs ADD CONSTRAINT bms_product_packs_unit_code_fkey
      FOREIGN KEY (unit_code) REFERENCES bms_master_units(code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_order_items_pack_unit_code_fkey') THEN
    ALTER TABLE bms_order_items ADD CONSTRAINT bms_order_items_pack_unit_code_fkey
      FOREIGN KEY (pack_unit_code) REFERENCES bms_master_units(code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_customer_addresses_province_code_fkey') THEN
    ALTER TABLE bms_customer_addresses ADD CONSTRAINT bms_customer_addresses_province_code_fkey
      FOREIGN KEY (province_code) REFERENCES bms_master_th_provinces(code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_customer_addresses_district_code_fkey') THEN
    ALTER TABLE bms_customer_addresses ADD CONSTRAINT bms_customer_addresses_district_code_fkey
      FOREIGN KEY (district_code) REFERENCES bms_master_th_districts(code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bms_customer_addresses_subdistrict_code_fkey') THEN
    ALTER TABLE bms_customer_addresses ADD CONSTRAINT bms_customer_addresses_subdistrict_code_fkey
      FOREIGN KEY (subdistrict_code) REFERENCES bms_master_th_subdistricts(code);
  END IF;
END $$;

-- BOT FI codes and BAHTNET BICs. Names are concise display snapshots, not a
-- substitute for the regulated-institution directory.
INSERT INTO bms_master_banks
  (code, country_code, name_th, name_en, swift, sort_order, source, source_version)
VALUES
  ('002','TH','ธนาคารกรุงเทพ','Bangkok Bank','BKKBTHBK',10,'Bank of Thailand FI Code / BAHTNET','2026-10-16'),
  ('004','TH','ธนาคารกสิกรไทย','Kasikornbank','KASITHBK',20,'Bank of Thailand FI Code / BAHTNET','2026-10-16'),
  ('006','TH','ธนาคารกรุงไทย','Krung Thai Bank','KRTHTHBK',30,'Bank of Thailand FI Code / BAHTNET','2026-10-16'),
  ('011','TH','ธนาคารทหารไทยธนชาต','TMBThanachart Bank','TMBKTHBK',40,'Bank of Thailand FI Code / BAHTNET','2026-10-16'),
  ('014','TH','ธนาคารไทยพาณิชย์','Siam Commercial Bank','SICOTHBK',50,'Bank of Thailand FI Code / BAHTNET','2026-10-16'),
  ('025','TH','ธนาคารกรุงศรีอยุธยา','Bank of Ayudhya','AYUDTHBK',60,'Bank of Thailand FI Code / BAHTNET','2026-10-16'),
  ('030','TH','ธนาคารออมสิน','Government Savings Bank','GSBATHBK',70,'Bank of Thailand FI Code / BAHTNET','2026-10-16'),
  ('034','TH','ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร','Bank for Agriculture and Agricultural Cooperatives','BAABTHBK',80,'Bank of Thailand FI Code / BAHTNET','2026-10-16')
ON CONFLICT (country_code, code) DO NOTHING;

-- UN/ECE Recommendation 20 revision 14. Thai retail words that do not have a
-- distinct Rec 20 code remain aliases of the nearest standard count/package unit.
INSERT INTO bms_master_units
  (code, country_code, name_th, name_en, aliases, kind, base_factor, source, source_version)
VALUES
  ('H87','TH','ชิ้น','piece',ARRAY['ชิ้น','เม็ด','จาน','แก้ว'], 'COUNT',1,'UNECE Recommendation 20','revision 14 (2020)'),
  ('EA','TH','หน่วย','each',ARRAY['หน่วย'], 'COUNT',1,'UNECE Recommendation 20','revision 14 (2020)'),
  ('BX','TH','กล่อง','box',ARRAY['กล่อง'], 'COUNT',1,'UNECE Recommendation 20','revision 14 (2020)'),
  ('PK','TH','แพ็ก','package',ARRAY['แพ็ก','แพ็ค','แผง'], 'COUNT',1,'UNECE Recommendation 20','revision 14 (2020)'),
  ('BO','TH','ขวด','bottle',ARRAY['ขวด'], 'COUNT',1,'UNECE Recommendation 20','revision 14 (2020)'),
  ('CA','TH','กระป๋อง','can',ARRAY['กระป๋อง'], 'COUNT',1,'UNECE Recommendation 20','revision 14 (2020)'),
  ('BG','TH','ถุง','bag',ARRAY['ถุง'], 'COUNT',1,'UNECE Recommendation 20','revision 14 (2020)'),
  ('SET','TH','ชุด','set',ARRAY['ชุด'], 'COUNT',1,'UNECE Recommendation 20','revision 14 (2020)'),
  ('KGM','TH','กิโลกรัม','kilogram',ARRAY['กก.','กิโล','กิโลกรัม'], 'WEIGHT',1000,'UNECE Recommendation 20','revision 14 (2020)'),
  ('GRM','TH','กรัม','gram',ARRAY['กรัม','ก.'], 'WEIGHT',1,'UNECE Recommendation 20','revision 14 (2020)'),
  ('LTR','TH','ลิตร','litre',ARRAY['ลิตร','ล.'], 'VOLUME',1000,'UNECE Recommendation 20','revision 14 (2020)'),
  ('MLT','TH','มิลลิลิตร','millilitre',ARRAY['มล.','มิลลิลิตร'], 'VOLUME',1,'UNECE Recommendation 20','revision 14 (2020)')
ON CONFLICT (code) DO NOTHING;

SELECT public.create_revision_trigger('bms_master_banks');
SELECT public.create_revision_trigger('bms_master_units');
SELECT public.create_revision_trigger('bms_master_th_provinces');
SELECT public.create_revision_trigger('bms_master_th_districts');
SELECT public.create_revision_trigger('bms_master_th_subdistricts');

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'bms_master_banks','bms_master_units','bms_master_th_provinces',
    'bms_master_th_districts','bms_master_th_subdistricts'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', tbl);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE %I FROM bms_app', tbl);
    EXECUTE format('GRANT SELECT ON TABLE %I TO bms_app', tbl);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', tbl || '_revisions');
    EXECUTE format('GRANT SELECT ON TABLE %I TO bms_app', tbl || '_revisions');
  END LOOP;
END $$;

COMMENT ON TABLE bms_master_banks IS 'Platform-global bank directory. Tenant payment accounts retain bankName snapshots.';
COMMENT ON TABLE bms_master_units IS 'Platform-global UN/ECE Rec 20 units. Tenant product packs retain display names.';
COMMENT ON TABLE bms_master_th_subdistricts IS 'Imported Thai address reference data; provenance is mandatory and bulk data is never embedded in migrations.';

COMMIT;
