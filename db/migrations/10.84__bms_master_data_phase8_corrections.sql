-- Recovery-safe when the SQL client previously stopped in an aborted transaction.
ROLLBACK;
-- Phase 8 corrective migration: ISO country code, non-overlapping AI-rate periods,
-- and a trigger compatible with stores created after 10.83.
BEGIN;

-- The phase contract uses ISO 3166-1 alpha-2 (TH/AU/GB). 10.83 temporarily used
-- the common-language UK code. Preserve that row as inactive compatibility data;
-- existing profile references are moved to GB without guessing any other value.
INSERT INTO bms_master_countries
  (code,name_th,name_en,default_currency_code,default_timezone_code,
   address_dataset_status,active,source,source_version,updated_at)
SELECT 'GB',name_th,name_en,default_currency_code,default_timezone_code,
       address_dataset_status,true,source,source_version,now()
  FROM bms_master_countries
 WHERE code='UK'
ON CONFLICT(code) DO NOTHING;

UPDATE bms_store_profile SET country_code='GB' WHERE country_code='UK';
UPDATE bms_master_countries SET active=false,updated_at=now() WHERE code='UK' AND active;

CREATE OR REPLACE FUNCTION public.trg_bms_store_profile_reference_codes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.country_code := CASE
    WHEN NULLIF(trim(NEW.country),'') IS NULL THEN NULL
    WHEN upper(trim(NEW.country)) IN ('TH','THAILAND') OR trim(NEW.country)='ประเทศไทย' THEN 'TH'
    WHEN upper(trim(NEW.country)) IN ('AU','AUSTRALIA') THEN 'AU'
    WHEN upper(trim(NEW.country)) IN ('GB','UK','UNITED KINGDOM') THEN 'GB'
    ELSE NULL END;
  NEW.currency_code := CASE WHEN upper(trim(COALESCE(NEW.currency,''))) IN
    (SELECT code FROM bms_master_currencies WHERE active) THEN upper(trim(NEW.currency)) ELSE NULL END;
  NEW.timezone_code := CASE WHEN trim(COALESCE(NEW.timezone,'')) IN
    (SELECT code FROM bms_master_timezones WHERE active) THEN trim(NEW.timezone) ELSE NULL END;
  RETURN NEW;
END $$;

-- Normalizing an existing overlap does not recalculate finalized events. The
-- lookup already selected the newest effective_from; closing its predecessor at
-- that boundary only makes the stored intervals express the same decision.
WITH ordered AS (
  SELECT id,
         lead(effective_from) OVER (
           PARTITION BY lower(provider),lower(model)
           ORDER BY effective_from,id
         ) AS next_effective_from
    FROM bms_master_ai_rates
   WHERE active
)
UPDATE bms_master_ai_rates rate
   SET effective_to=ordered.next_effective_from,updated_at=now()
  FROM ordered
 WHERE rate.id=ordered.id
   AND rate.effective_to IS DISTINCT FROM ordered.next_effective_from;

CREATE OR REPLACE FUNCTION public.add_bms_ai_rate(
 p_provider text,p_model text,p_input numeric,p_output numeric,p_cache_create numeric,p_cache_read numeric,
 p_effective_from timestamptz,p_source text,p_source_version text
) RETURNS SETOF bms_master_ai_rates
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_provider text := lower(trim(p_provider));
  v_model text := trim(p_model);
  v_next timestamptz;
BEGIN
  IF v_provider='' OR v_model='' OR trim(p_source)='' OR trim(p_source_version)='' THEN
    RAISE EXCEPTION 'AI_RATE_FIELDS_INVALID';
  END IF;
  IF p_effective_from < now() - interval '1 minute' THEN RAISE EXCEPTION 'AI_RATE_BACKDATE_FORBIDDEN'; END IF;
  IF p_input < 0 OR p_output < 0 OR p_cache_create < 0 OR p_cache_read < 0 THEN RAISE EXCEPTION 'AI_RATE_INVALID'; END IF;

  -- Serialize one provider/model timeline so two platform admins cannot create
  -- overlapping open-ended periods concurrently.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_provider || E'\n' || lower(v_model),0));
  SELECT min(effective_from) INTO v_next
    FROM bms_master_ai_rates
   WHERE lower(provider)=v_provider AND lower(model)=lower(v_model) AND active
     AND effective_from > p_effective_from;

  UPDATE bms_master_ai_rates
     SET effective_to=p_effective_from,updated_at=now()
   WHERE lower(provider)=v_provider AND lower(model)=lower(v_model) AND active
     AND effective_from < p_effective_from
     AND (effective_to IS NULL OR effective_to > p_effective_from);

  RETURN QUERY INSERT INTO bms_master_ai_rates(
    provider,model,input_usd_per_million,output_usd_per_million,
    cache_creation_multiplier,cache_read_multiplier,effective_from,effective_to,source,source_version
  ) VALUES(
    v_provider,v_model,p_input,p_output,p_cache_create,p_cache_read,
    p_effective_from,v_next,trim(p_source),trim(p_source_version)
  ) RETURNING *;
END $$;

REVOKE ALL ON FUNCTION public.add_bms_ai_rate(text,text,numeric,numeric,numeric,numeric,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_bms_ai_rate(text,text,numeric,numeric,numeric,numeric,timestamptz,text,text) TO bms_app;

COMMENT ON FUNCTION public.add_bms_ai_rate(text,text,numeric,numeric,numeric,numeric,timestamptz,text,text)
  IS 'Adds one future-effective, non-overlapping AI accounting rate; application platform-admin authorization and same-tx audit remain mandatory.';

COMMIT;

-- ROLLBACK: deploy the previous application first. Keep GB and profile references;
-- reactivating UK would reintroduce a non-ISO country authority. The prior AI-rate
-- function may be restored only if no future rates were inserted through this one.
