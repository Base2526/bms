BEGIN;

-- The legacy users table is not protected by BMS tenant RLS. Keep bms_app away
-- from a direct users.is_available UPDATE grant and enforce tenant + self scope
-- inside this narrow function instead.
CREATE OR REPLACE FUNCTION bms_set_own_inbox_availability(
  p_tenant_id uuid,
  p_user_id uuid,
  p_available boolean
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_tenant_id IS NULL OR p_user_id IS NULL OR p_available IS NULL THEN
    RAISE EXCEPTION 'Invalid Inbox availability input' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(current_setting('bms.tenant_id', true), '') IS DISTINCT FROM p_tenant_id::text
     OR NULLIF(current_setting('app.editor_id', true), '') IS DISTINCT FROM p_user_id::text THEN
    RAISE EXCEPTION 'Inbox availability requires the acting tenant and user'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.users SET is_available = p_available
   WHERE tenant_id = p_tenant_id AND id = p_user_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION bms_set_own_inbox_availability(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bms_set_own_inbox_availability(uuid, uuid, boolean) TO bms_app;

COMMIT;

-- ROLLBACK: deploy the prior application first, then REVOKE EXECUTE from bms_app
-- and DROP FUNCTION bms_set_own_inbox_availability(uuid, uuid, boolean).
