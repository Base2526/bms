-- Bootstrap only for the isolated realtime migration test cluster.
-- pg_dump does not include cluster roles, but restored policies and ACLs refer to bms_app.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bms_app') THEN
    CREATE ROLE bms_app NOLOGIN NOBYPASSRLS;
  END IF;

  EXECUTE format('GRANT bms_app TO %I', current_user);
END $$;
