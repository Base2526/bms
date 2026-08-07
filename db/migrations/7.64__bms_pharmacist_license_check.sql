-- Tenant-scoped, least-privilege license check for pharmacy decisions.
-- bms_app intentionally has no broad SELECT grant on users.
CREATE OR REPLACE FUNCTION public.bms_is_licensed_pharmacist(
  p_tenant_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.users
     WHERE tenant_id = p_tenant_id
       AND id = p_user_id
       AND is_licensed_pharmacist = TRUE
  );
$$;

REVOKE ALL ON FUNCTION public.bms_is_licensed_pharmacist(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bms_is_licensed_pharmacist(UUID, UUID) TO bms_app;

