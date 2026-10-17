-- Recovery-safe when the SQL client previously stopped in an aborted transaction.
ROLLBACK;
-- Keep the Phase 8 unknown-reference report current after the one-time backfill.
BEGIN;

CREATE OR REPLACE FUNCTION public.trg_bms_store_profile_reference_issues() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  UPDATE bms_master_reference_backfill_issues
     SET resolved_at=now()
   WHERE tenant_id=NEW.tenant_id AND field='country' AND resolved_at IS NULL
     AND (NEW.country_code IS NOT NULL OR raw_value IS DISTINCT FROM NEW.country);
  UPDATE bms_master_reference_backfill_issues
     SET resolved_at=now()
   WHERE tenant_id=NEW.tenant_id AND field='currency' AND resolved_at IS NULL
     AND (NEW.currency_code IS NOT NULL OR raw_value IS DISTINCT FROM NEW.currency);
  UPDATE bms_master_reference_backfill_issues
     SET resolved_at=now()
   WHERE tenant_id=NEW.tenant_id AND field='timezone' AND resolved_at IS NULL
     AND (NEW.timezone_code IS NOT NULL OR raw_value IS DISTINCT FROM NEW.timezone);

  IF NULLIF(btrim(NEW.country),'') IS NOT NULL AND NEW.country_code IS NULL THEN
    INSERT INTO bms_master_reference_backfill_issues(tenant_id,field,raw_value,resolved_at)
    VALUES(NEW.tenant_id,'country',NEW.country,NULL)
    ON CONFLICT(tenant_id,field,raw_value) DO UPDATE SET resolved_at=NULL,detected_at=now();
  END IF;
  IF NULLIF(btrim(NEW.currency),'') IS NOT NULL AND NEW.currency_code IS NULL THEN
    INSERT INTO bms_master_reference_backfill_issues(tenant_id,field,raw_value,resolved_at)
    VALUES(NEW.tenant_id,'currency',NEW.currency,NULL)
    ON CONFLICT(tenant_id,field,raw_value) DO UPDATE SET resolved_at=NULL,detected_at=now();
  END IF;
  IF NULLIF(btrim(NEW.timezone),'') IS NOT NULL AND NEW.timezone_code IS NULL THEN
    INSERT INTO bms_master_reference_backfill_issues(tenant_id,field,raw_value,resolved_at)
    VALUES(NEW.tenant_id,'timezone',NEW.timezone,NULL)
    ON CONFLICT(tenant_id,field,raw_value) DO UPDATE SET resolved_at=NULL,detected_at=now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bms_store_profile_reference_issues_trg ON bms_store_profile;
CREATE TRIGGER bms_store_profile_reference_issues_trg
AFTER INSERT OR UPDATE OF country,currency,timezone ON bms_store_profile
FOR EACH ROW EXECUTE FUNCTION public.trg_bms_store_profile_reference_issues();

COMMENT ON FUNCTION public.trg_bms_store_profile_reference_issues()
  IS 'Maintains the tenant-scoped unresolved country/currency/timezone ledger after the Phase 8 backfill.';

COMMIT;

-- ROLLBACK: the trigger may be dropped after the previous application is deployed.
-- Keep the issue ledger and its resolved history for auditability.
