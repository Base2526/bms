-- 10.47: pin the pharmacist licence and its snapshot inside guidance approval.
-- bms_app has no general read/update access to licence columns on users. This
-- narrow helper reads only one user in the transaction's tenant and holds a
-- SHARE row lock until approval/audit commit, serialising licence revocation.
-- No new permission, approved content, feature flag or protocol activation.
-- Apply after 7.64 and 10.45. Idempotent; needed for NEW approvals only.
-- ROLLBACK (also roll back the app's approval caller; customer reads are unchanged):
-- DROP FUNCTION IF EXISTS public.bms_lock_guidance_pharmacist_license(UUID, UUID);

CREATE OR REPLACE FUNCTION public.bms_lock_guidance_pharmacist_license(
  p_tenant_id UUID, p_user_id UUID
) RETURNS TABLE (ok BOOLEAN, license_no TEXT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  locked_licensed BOOLEAN;
BEGIN
  IF NULLIF(current_setting('bms.tenant_id', true), '')::uuid IS DISTINCT FROM p_tenant_id
     OR p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Guidance approval requires the transaction tenant' USING ERRCODE = '42501';
  END IF;
  SELECT u.is_licensed_pharmacist, NULLIF(btrim(u.pharmacist_license_no), '')
    INTO locked_licensed, license_no
    FROM public.users u WHERE u.tenant_id = p_tenant_id AND u.id = p_user_id
    FOR SHARE OF u;
  IF NOT FOUND THEN RETURN; END IF;
  ok := locked_licensed IS TRUE AND public.bms_is_licensed_pharmacist(p_tenant_id, p_user_id);
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.bms_lock_guidance_pharmacist_license(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bms_lock_guidance_pharmacist_license(UUID, UUID) TO bms_app;
