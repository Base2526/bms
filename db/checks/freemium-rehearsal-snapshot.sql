-- READ-ONLY rehearsal evidence. Run before 10.73, after 10.75, then after a rerun.
-- Only the isolated restored database bms_realtime_test is accepted.
-- Outputs counts/fingerprints and global catalogue metadata, never tenant/customer rows.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '2s';
SET LOCAL search_path = public, pg_catalog;

DO $$ BEGIN
  IF current_database() <> 'bms_realtime_test' THEN
    RAISE EXCEPTION 'Refusing non-rehearsal database. Expected bms_realtime_test.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Use the isolated restore superuser so fingerprints cover every tenant, not an RLS-filtered subset.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='bms_app' AND NOT rolbypassrls AND NOT rolsuper) THEN
    RAISE EXCEPTION 'Restore prerequisite: bms_app must exist without SUPERUSER/BYPASSRLS.';
  END IF;
END $$;

-- Fail early on missing prerequisites/ACLs instead of silently treating absent data as zero.
DO $$
DECLARE r record; privilege text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('bms_tenants',ARRAY['SELECT','UPDATE']), ('bms_plans',ARRAY['SELECT']),
    ('bms_locations',ARRAY['SELECT','INSERT','UPDATE']),
    ('bms_pos_devices',ARRAY['SELECT','INSERT','UPDATE']),
    ('bms_tenant_channels',ARRAY['SELECT','INSERT','UPDATE']),
    ('bms_audit_log',ARRAY['SELECT','INSERT']),
    ('bms_report_subscriptions',ARRAY['SELECT','INSERT','UPDATE']),
    ('bms_retention_cases',ARRAY['SELECT','INSERT','UPDATE']),
    ('bms_ai_usage_events',ARRAY['SELECT','INSERT','UPDATE']),
    ('bms_ai_usage_monthly',ARRAY['SELECT','INSERT','UPDATE'])
  ) AS requirements(table_name, privileges) LOOP
    IF to_regclass(format('public.%I',r.table_name)) IS NULL THEN
      RAISE EXCEPTION 'Missing prerequisite table: %',r.table_name;
    END IF;
    FOREACH privilege IN ARRAY r.privileges LOOP
      IF NOT has_table_privilege('bms_app',format('public.%I',r.table_name),privilege) THEN
        RAISE EXCEPTION 'Missing prerequisite grant: bms_app % on %',privilege,r.table_name;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Order-independent, constant-memory fingerprints over complete row values. Two 64-bit
-- hash sums plus row count detect accidental changes without printing PII/credentials.
-- Exclude ONLY the two intentionally added tenant policy columns from the row payload.
DO $$
DECLARE table_name text; result record; payload text;
BEGIN
  -- Cover every restored public table, including operational/audit tables not known
  -- to this feature. Only catalogue edits and the new evidence table are intentional.
  FOR table_name IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition
       AND c.relname NOT IN ('bms_plans','bms_package_events')
     ORDER BY c.relname
  LOOP
    IF to_regclass(format('public.%I',table_name)) IS NULL THEN
      RAISE EXCEPTION 'Missing fingerprint table: %',table_name;
    END IF;
    payload := CASE WHEN table_name='bms_tenants'
      THEN '(to_jsonb(t) - ''feature_policy_version'' - ''capacity_policy_version'')'
      ELSE 'to_jsonb(t)' END;
    EXECUTE format('SELECT count(*) AS rows,
      coalesce(sum((''x''||substr(md5(payload::text),1,16))::bit(64)::bigint::numeric),0) AS hash_a,
      coalesce(sum((''x''||substr(md5(payload::text),17,16))::bit(64)::bigint::numeric),0) AS hash_b
      FROM (SELECT %s AS payload FROM public.%I t) s',payload,table_name) INTO result;
    RAISE NOTICE 'FINGERPRINT %',json_build_object('table',table_name,'rows',result.rows,'hashA',result.hash_a,'hashB',result.hash_b);
  END LOOP;
END $$;

SELECT code, to_jsonb(p) AS catalogue FROM bms_plans p ORDER BY code;
SELECT coalesce((to_jsonb(t)->>'feature_policy_version')::int,1) AS feature_version,
       coalesce((to_jsonb(t)->>'capacity_policy_version')::int,1) AS capacity_version,
       count(*) AS tenants
  FROM bms_tenants t GROUP BY 1,2 ORDER BY 1,2;
SELECT column_name, column_default FROM information_schema.columns
 WHERE table_schema='public' AND table_name='bms_tenants'
   AND column_name IN ('feature_policy_version','capacity_policy_version') ORDER BY column_name;

-- Existing business triggers are part of baseline evidence. A missing owner/grant can
-- roll back a business write even when the freemium migrations compile successfully.
SELECT p.proname, r.rolname AS owner, r.rolbypassrls
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
 WHERE n.nspname='public' AND p.proname LIKE 'bms_realtime%' ORDER BY p.proname;
SELECT c.relname, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) AS definition
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND NOT t.tgisinternal AND c.relname LIKE 'bms_%'
 ORDER BY c.relname,t.tgname;
ROLLBACK;
