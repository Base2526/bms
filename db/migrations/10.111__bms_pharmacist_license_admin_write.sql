-- 10.111 — Tenant-bound Administrator update of a pharmacist licence fact.
-- bms_app must not receive a general UPDATE grant on the sensitive users columns.
-- Apply after 7.57 and 10.47. Safe to re-run.
-- ROLLBACK: deploy the previous app version, then
-- DROP FUNCTION IF EXISTS public.bms_set_pharmacist_license(UUID, UUID, BOOLEAN, TEXT);

CREATE OR REPLACE FUNCTION public.bms_set_pharmacist_license(
  p_tenant_id UUID,
  p_user_id UUID,
  p_is_licensed BOOLEAN,
  p_license_no TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  changed BOOLEAN;
BEGIN
  IF p_tenant_id IS NULL
     OR NULLIF(current_setting('bms.tenant_id', true), '')::uuid IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'Pharmacist licence update requires tenant Administrator'
      USING ERRCODE = '42501';
  END IF;
  -- Hold the actor's role through the target update and audit commit.
  PERFORM 1 FROM public.users actor
   WHERE actor.tenant_id = p_tenant_id
     AND actor.id = NULLIF(current_setting('app.editor_id', true), '')::uuid
     AND actor.role = 'Administrator'
   FOR SHARE OF actor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pharmacist licence update requires tenant Administrator'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.users target
     SET is_licensed_pharmacist = p_is_licensed,
         pharmacist_license_no = NULLIF(btrim(p_license_no), '')
   WHERE target.id = p_user_id AND target.tenant_id = p_tenant_id;
  changed := FOUND;
  RETURN changed;
END;
$$;

REVOKE ALL ON FUNCTION public.bms_set_pharmacist_license(UUID, UUID, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bms_set_pharmacist_license(UUID, UUID, BOOLEAN, TEXT) TO bms_app;
