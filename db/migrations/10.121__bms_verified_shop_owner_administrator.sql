BEGIN;

-- A verified self-serve shop owner needs the Administrator role to manage
-- tenant settings and the role matrix. Do not promote ordinary Managers.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM roles WHERE name = 'Administrator' AND is_active) THEN
    RAISE EXCEPTION 'Active Administrator role is required before owner repair';
  END IF;
END $$;

WITH eligible AS (
  SELECT DISTINCT u.id, u.tenant_id
    FROM bms_pending_shop_signups p
    JOIN users u
      ON u.tenant_id = p.tenant_id
     AND lower(btrim(u.email)) = lower(btrim(p.email))
    JOIN roles assigned_role ON assigned_role.id = u.role_id AND assigned_role.name = 'Manager'
   WHERE p.verified_at IS NOT NULL
     AND p.tenant_id IS NOT NULL
     AND u.is_email_verified = TRUE
     AND u.role = 'Manager'
     AND u.created_at >= p.created_at
     AND u.created_at <= p.verified_at + interval '5 minutes'
     AND NOT EXISTS (
       SELECT 1 FROM users other_user
       JOIN roles other_role ON other_role.id = other_user.role_id
      WHERE other_user.tenant_id = u.tenant_id AND other_role.name = 'Administrator'
     )
     AND NOT EXISTS (
       SELECT 1 FROM bms_audit_log prior_change
        WHERE prior_change.tenant_id = u.tenant_id
          AND prior_change.target = u.id::text
          AND prior_change.action = 'user.update'
     )
), promoted AS (
  UPDATE users u
     SET role = 'Administrator',
         role_id = (SELECT id FROM roles WHERE name = 'Administrator' AND is_active LIMIT 1),
         admin_session_version = COALESCE(u.admin_session_version, 0) + 1
    FROM eligible e
   WHERE u.id = e.id AND u.tenant_id = e.tenant_id
   RETURNING u.id, u.tenant_id
)
INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
SELECT tenant_id, 'migration:10.121', 'shop.signup.owner_role_repaired', id::text,
       '{"fromRole":"Manager","toRole":"Administrator","source":"verified_email_signup"}'::jsonb
  FROM promoted;

COMMIT;

-- ROLLBACK: do not demote an owner automatically after access may have been used.
-- Restore a specific account only after reviewing its signup and subsequent audit history.
