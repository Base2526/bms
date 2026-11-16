-- Idempotent follow-up to the narrowly scoped 10.121 owner repair. The ordered
-- 10.121 file now sets a transaction-local timeout; this file also covers
-- databases that previously applied the pre-timeout 10.121 version.
--
-- If a prior HeidiSQL attempt failed, execute ROLLBACK as a separate statement
-- in that same connection before running the ordered migration sequence. A
-- timeout aborts the whole transaction, including the role change and audit.
-- This repair has no dependency on the intervening factory migrations; normal
-- ordered installs run it after the now-bounded 10.121.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';
-- A second operator retry must wait or fail instead of racing the same owners.
SELECT pg_advisory_xact_lock(hashtextextended('bms-verified-shop-owner-repair', 0));

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
SELECT tenant_id, 'migration:10.128', 'shop.signup.owner_role_repaired', id::text,
       '{"fromRole":"Manager","toRole":"Administrator","source":"verified_email_signup"}'::jsonb
  FROM promoted;

COMMIT;

-- ROLLBACK: do not demote an owner automatically after access may have been used.
-- Restore a specific account only after reviewing its signup and later audit history.
