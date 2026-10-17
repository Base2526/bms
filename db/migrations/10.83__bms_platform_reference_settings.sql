-- Recovery-safe when the same SQL client previously hit an error.
ROLLBACK;
-- Phase 8: platform reference settings and multi-country foundations.
-- Application fallbacks remain mandatory during rolling deploys and DB outages.
BEGIN;

CREATE TABLE IF NOT EXISTS bms_master_currencies (
  code TEXT PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  name_th TEXT NOT NULL,
  name_en TEXT NOT NULL,
  symbol TEXT NOT NULL,
  minor_units SMALLINT NOT NULL DEFAULT 2 CHECK (minor_units BETWEEN 0 AND 4),
  active BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bms_master_timezones (
  code TEXT PRIMARY KEY,
  name_th TEXT NOT NULL,
  name_en TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (code = 'UTC' OR code ~ '^[A-Za-z_+-]+/[A-Za-z0-9_+.-]+$')
);

CREATE TABLE IF NOT EXISTS bms_master_countries (
  code TEXT PRIMARY KEY CHECK (code ~ '^[A-Z]{2}$'),
  name_th TEXT NOT NULL,
  name_en TEXT NOT NULL,
  default_currency_code TEXT NOT NULL REFERENCES bms_master_currencies(code),
  default_timezone_code TEXT NOT NULL REFERENCES bms_master_timezones(code),
  address_dataset_status TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED'
    CHECK (address_dataset_status IN ('READY','REVIEW_REQUIRED','BLOCKED')),
  active BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO bms_master_currencies(code,name_th,name_en,symbol,minor_units,source,source_version) VALUES
  ('THB','บาทไทย','Thai baht','฿',2,'ISO 4217 / existing BMS locale contract','phase-8'),
  ('AUD','ดอลลาร์ออสเตรเลีย','Australian dollar','A$',2,'ISO 4217 / existing BMS locale contract','phase-8'),
  ('GBP','ปอนด์สเตอร์ลิง','Pound sterling','£',2,'ISO 4217 / existing BMS locale contract','phase-8')
ON CONFLICT(code) DO NOTHING;

INSERT INTO bms_master_timezones(code,name_th,name_en,source,source_version) VALUES
  ('Asia/Bangkok','เวลาไทย','Bangkok time','IANA tzdb identifier','phase-8'),
  ('Australia/Sydney','เวลาซิดนีย์','Sydney time','IANA tzdb identifier','phase-8'),
  ('Europe/London','เวลาลอนดอน','London time','IANA tzdb identifier','phase-8')
ON CONFLICT(code) DO NOTHING;

INSERT INTO bms_master_countries
  (code,name_th,name_en,default_currency_code,default_timezone_code,address_dataset_status,source,source_version) VALUES
  ('TH','ไทย','Thailand','THB','Asia/Bangkok','READY','ISO 3166 / existing BMS locale contract','phase-8'),
  ('AU','ออสเตรเลีย','Australia','AUD','Australia/Sydney','REVIEW_REQUIRED','ISO 3166 / existing BMS locale contract','phase-8'),
  ('UK','สหราชอาณาจักร','United Kingdom','GBP','Europe/London','REVIEW_REQUIRED','BMS compatibility code (ISO alpha-2 is GB)','phase-8')
ON CONFLICT(code) DO NOTHING;

-- Schema only. No AU/UK locality rows may be imported until both residency and
-- dataset licence evidence are reviewed and the corresponding country is READY.
CREATE TABLE IF NOT EXISTS bms_master_au_states (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  licence_reference TEXT NOT NULL,
  residency_reference TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bms_master_au_suburbs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code TEXT NOT NULL REFERENCES bms_master_au_states(code),
  suburb TEXT NOT NULL,
  postcode TEXT NOT NULL CHECK (postcode ~ '^[0-9]{4}$'),
  active BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  licence_reference TEXT NOT NULL,
  residency_reference TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(state_code,suburb,postcode)
);
CREATE TABLE IF NOT EXISTS bms_master_uk_postcodes (
  postcode TEXT PRIMARY KEY,
  outward_code TEXT NOT NULL,
  region TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  licence_reference TEXT NOT NULL,
  residency_reference TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE bms_store_profile
  ADD COLUMN IF NOT EXISTS country_code TEXT,
  ADD COLUMN IF NOT EXISTS currency_code TEXT,
  ADD COLUMN IF NOT EXISTS timezone_code TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_store_profile_country_code_fkey') THEN
    ALTER TABLE bms_store_profile ADD CONSTRAINT bms_store_profile_country_code_fkey
      FOREIGN KEY(country_code) REFERENCES bms_master_countries(code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_store_profile_currency_code_fkey') THEN
    ALTER TABLE bms_store_profile ADD CONSTRAINT bms_store_profile_currency_code_fkey
      FOREIGN KEY(currency_code) REFERENCES bms_master_currencies(code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bms_store_profile_timezone_code_fkey') THEN
    ALTER TABLE bms_store_profile ADD CONSTRAINT bms_store_profile_timezone_code_fkey
      FOREIGN KEY(timezone_code) REFERENCES bms_master_timezones(code);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.trg_bms_store_profile_reference_codes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.country_code := CASE
    WHEN NULLIF(trim(NEW.country),'') IS NULL THEN NULL
    WHEN upper(trim(NEW.country)) IN ('TH','THAILAND') OR trim(NEW.country)='ประเทศไทย' THEN 'TH'
    WHEN upper(trim(NEW.country)) IN ('AU','AUSTRALIA') THEN 'AU'
    WHEN upper(trim(NEW.country)) IN ('UK','GB','UNITED KINGDOM') THEN 'UK'
    ELSE NULL END;
  NEW.currency_code := CASE WHEN upper(trim(COALESCE(NEW.currency,''))) IN
    (SELECT code FROM bms_master_currencies WHERE active) THEN upper(trim(NEW.currency)) ELSE NULL END;
  NEW.timezone_code := CASE WHEN trim(COALESCE(NEW.timezone,'')) IN
    (SELECT code FROM bms_master_timezones WHERE active) THEN trim(NEW.timezone) ELSE NULL END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bms_store_profile_reference_codes_trg ON bms_store_profile;
CREATE TRIGGER bms_store_profile_reference_codes_trg BEFORE INSERT OR UPDATE OF country,currency,timezone
ON bms_store_profile FOR EACH ROW EXECUTE FUNCTION public.trg_bms_store_profile_reference_codes();

UPDATE bms_store_profile SET country_code = CASE
  WHEN upper(trim(country)) IN ('TH','THAILAND') OR trim(country)='ประเทศไทย' THEN 'TH'
  WHEN upper(trim(country)) IN ('AU','AUSTRALIA') THEN 'AU'
  WHEN upper(trim(country)) IN ('UK','GB','UNITED KINGDOM') THEN 'UK'
  ELSE country_code END
WHERE country_code IS NULL AND NULLIF(trim(country),'') IS NOT NULL;
UPDATE bms_store_profile SET currency_code=upper(trim(currency))
 WHERE currency_code IS NULL AND upper(trim(currency)) IN (SELECT code FROM bms_master_currencies);
UPDATE bms_store_profile SET timezone_code=trim(timezone)
 WHERE timezone_code IS NULL AND trim(timezone) IN (SELECT code FROM bms_master_timezones);

CREATE TABLE IF NOT EXISTS bms_master_reference_backfill_issues (
  tenant_id UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  field TEXT NOT NULL CHECK (field IN ('country','currency','timezone')),
  raw_value TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  PRIMARY KEY(tenant_id,field,raw_value)
);
INSERT INTO bms_master_reference_backfill_issues(tenant_id,field,raw_value)
SELECT tenant_id,'country',country FROM bms_store_profile WHERE NULLIF(trim(country),'') IS NOT NULL AND country_code IS NULL
ON CONFLICT DO NOTHING;
INSERT INTO bms_master_reference_backfill_issues(tenant_id,field,raw_value)
SELECT tenant_id,'currency',currency FROM bms_store_profile WHERE NULLIF(trim(currency),'') IS NOT NULL AND currency_code IS NULL
ON CONFLICT DO NOTHING;
INSERT INTO bms_master_reference_backfill_issues(tenant_id,field,raw_value)
SELECT tenant_id,'timezone',timezone FROM bms_store_profile WHERE NULLIF(trim(timezone),'') IS NOT NULL AND timezone_code IS NULL
ON CONFLICT DO NOTHING;
ALTER TABLE bms_master_reference_backfill_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_master_reference_backfill_issues FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_master_reference_backfill_issues_tenant ON bms_master_reference_backfill_issues;
CREATE POLICY bms_master_reference_backfill_issues_tenant ON bms_master_reference_backfill_issues
  USING (tenant_id=NULLIF(current_setting('bms.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('bms.tenant_id',true),'')::uuid);

CREATE TABLE IF NOT EXISTS bms_master_ai_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_usd_per_million NUMERIC(14,8) NOT NULL CHECK (input_usd_per_million >= 0),
  output_usd_per_million NUMERIC(14,8) NOT NULL CHECK (output_usd_per_million >= 0),
  cache_creation_multiplier NUMERIC(12,8) NOT NULL DEFAULT 1 CHECK (cache_creation_multiplier >= 0),
  cache_read_multiplier NUMERIC(12,8) NOT NULL DEFAULT 1 CHECK (cache_read_multiplier >= 0),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider,model,effective_from),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX IF NOT EXISTS bms_master_ai_rates_lookup
  ON bms_master_ai_rates(provider,model,effective_from DESC) WHERE active;

INSERT INTO bms_master_ai_rates
 (provider,model,input_usd_per_million,output_usd_per_million,cache_creation_multiplier,cache_read_multiplier,effective_from,source,source_version) VALUES
 ('deepseek','deepseek-flash',0.3,1.2,1,0.02,'2026-10-09T00:00:00Z','BMS reviewed fallback rate card','2026-10-09'),
 ('deepseek','deepseek-v4-flash',0.3,1.2,1,0.02,'2026-10-09T00:00:00Z','BMS reviewed fallback rate card','2026-10-09'),
 ('deepseek','deepseek-v4-flash-vision-exp',0.3,1.2,1,0.02,'2026-10-09T00:00:00Z','BMS reviewed fallback rate card','2026-10-09'),
 ('deepseek','deepseek-v4-pro',1.32,3.96,1,0.03333333,'2026-10-09T00:00:00Z','BMS reviewed fallback rate card','2026-10-09'),
 ('qwen','qwen-vl-ocr',0.043,0.072,1,1,'2026-10-09T00:00:00Z','BMS reviewed fallback rate card','2026-10-09'),
 ('qwen','qwen-vl-ocr-latest',0.043,0.072,1,1,'2026-10-09T00:00:00Z','BMS reviewed fallback rate card','2026-10-09'),
 ('qwen','qwen-vl-ocr-2025-11-20',0.043,0.072,1,1,'2026-10-09T00:00:00Z','BMS reviewed fallback rate card','2026-10-09')
ON CONFLICT(provider,model,effective_from) DO NOTHING;

CREATE OR REPLACE FUNCTION public.add_bms_ai_rate(
 p_provider text,p_model text,p_input numeric,p_output numeric,p_cache_create numeric,p_cache_read numeric,
 p_effective_from timestamptz,p_source text,p_source_version text
) RETURNS SETOF bms_master_ai_rates LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF p_effective_from < now() - interval '1 minute' THEN RAISE EXCEPTION 'AI_RATE_BACKDATE_FORBIDDEN'; END IF;
  IF p_input < 0 OR p_output < 0 OR p_cache_create < 0 OR p_cache_read < 0 THEN RAISE EXCEPTION 'AI_RATE_INVALID'; END IF;
  UPDATE bms_master_ai_rates SET effective_to=p_effective_from,updated_at=now()
   WHERE lower(provider)=lower(p_provider) AND lower(model)=lower(p_model) AND active
     AND effective_from < p_effective_from AND (effective_to IS NULL OR effective_to > p_effective_from);
  RETURN QUERY INSERT INTO bms_master_ai_rates(provider,model,input_usd_per_million,output_usd_per_million,
    cache_creation_multiplier,cache_read_multiplier,effective_from,source,source_version)
    VALUES(lower(trim(p_provider)),trim(p_model),p_input,p_output,p_cache_create,p_cache_read,p_effective_from,trim(p_source),trim(p_source_version))
    RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.add_bms_ai_rate(text,text,numeric,numeric,numeric,numeric,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_bms_ai_rate(text,text,numeric,numeric,numeric,numeric,timestamptz,text,text) TO bms_app;

ALTER TABLE bms_plans
  ADD COLUMN IF NOT EXISTS feature_keys TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE bms_plans SET feature_keys=CASE code
  WHEN 'pro' THEN ARRAY['REPORT_SCHEDULE']::text[]
  WHEN 'business' THEN ARRAY['REPORT_SCHEDULE','RETENTION_ENGINE']::text[]
  ELSE ARRAY[]::text[] END
WHERE feature_keys='{}';

CREATE OR REPLACE FUNCTION public.update_bms_plan_catalog(
 p_code text,p_expected_version integer,p_name text,p_price numeric,p_max_products integer,
 p_max_channels integer,p_max_orders integer,p_max_users integer,p_max_branches integer,
 p_max_devices integer,p_max_ai integer,p_ai_credits integer,p_features text[]
) RETURNS SETOF bms_plans LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM unnest(COALESCE(p_features,ARRAY[]::text[])) AS feature(feature_key)
    WHERE feature_key NOT IN ('REPORT_SCHEDULE','RETENTION_ENGINE')) THEN
    RAISE EXCEPTION 'PLAN_FEATURE_INVALID';
  END IF;
  RETURN QUERY UPDATE bms_plans SET name=p_name,price_monthly=p_price,max_products=p_max_products,
    max_channels=p_max_channels,max_orders_month=p_max_orders,max_users=p_max_users,
    max_branches=p_max_branches,max_devices=p_max_devices,max_ai_messages_month=p_max_ai,
    ai_credits_monthly=p_ai_credits,feature_keys=COALESCE(p_features,ARRAY[]::text[]),version=version+1,updated_at=now()
   WHERE code=p_code AND version=p_expected_version RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.update_bms_plan_catalog(text,integer,text,numeric,integer,integer,integer,integer,integer,integer,integer,integer,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_bms_plan_catalog(text,integer,text,numeric,integer,integer,integer,integer,integer,integer,integer,integer,text[]) TO bms_app;

GRANT SELECT ON bms_master_countries,bms_master_currencies,bms_master_timezones,
  bms_master_au_states,bms_master_au_suburbs,bms_master_uk_postcodes,bms_master_ai_rates TO bms_app;
GRANT SELECT,INSERT,UPDATE ON bms_master_reference_backfill_issues TO bms_app;
REVOKE INSERT,UPDATE,DELETE ON bms_master_countries,bms_master_currencies,bms_master_timezones,
  bms_master_au_states,bms_master_au_suburbs,bms_master_uk_postcodes,bms_master_ai_rates,bms_plans FROM bms_app;

SELECT public.create_global_revision_trigger('bms_master_countries');
SELECT public.create_global_revision_trigger('bms_master_currencies');
SELECT public.create_global_revision_trigger('bms_master_timezones');
SELECT public.create_global_revision_trigger('bms_master_ai_rates');
SELECT public.create_global_revision_trigger('bms_plans');

COMMENT ON TABLE bms_master_ai_rates IS 'Accounting attribution only; never an entitlement or provider invoice. Existing finalized events are immutable.';
COMMENT ON COLUMN bms_store_profile.timezone_code IS 'Validated IANA timezone. Legacy timezone remains a compatibility snapshot during rollout.';
COMMENT ON TABLE bms_master_au_suburbs IS 'Empty until AU residency and dataset licence review is recorded. Schema presence is not import approval.';
COMMENT ON TABLE bms_master_uk_postcodes IS 'Empty until UK residency and dataset licence review is recorded. Schema presence is not import approval.';

COMMIT;

-- ROLLBACK: deploy the previous application first. Keep additive master tables,
-- profile codes, issue ledger, plan versions and revisions. Do not delete finalized
-- AI cost or tenant data. Revoke the plan update function if the editor is disabled.
