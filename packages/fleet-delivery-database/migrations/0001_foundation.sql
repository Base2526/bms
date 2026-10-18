CREATE EXTENSION IF NOT EXISTS postgis;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet_delivery_app') THEN
    CREATE ROLE fleet_delivery_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet_delivery_worker') THEN
    CREATE ROLE fleet_delivery_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS fleet_delivery;
REVOKE ALL ON SCHEMA fleet_delivery FROM PUBLIC;
GRANT USAGE ON SCHEMA fleet_delivery TO fleet_delivery_app, fleet_delivery_worker;

CREATE TABLE IF NOT EXISTS fleet_delivery.integration_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_subject text NOT NULL,
  external_tenant_ref text NOT NULL,
  external_branch_ref text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (principal_subject, external_tenant_ref, external_branch_ref)
);

CREATE TABLE IF NOT EXISTS fleet_delivery.service_principal_revocations (
  issuer text NOT NULL,
  principal_subject text NOT NULL,
  token_jti text,
  key_id text,
  reason text NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CHECK (token_jti IS NOT NULL OR key_id IS NOT NULL),
  UNIQUE NULLS NOT DISTINCT (issuer, principal_subject, token_jti, key_id)
);

CREATE TABLE IF NOT EXISTS fleet_delivery.inbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  producer text NOT NULL,
  message_id uuid NOT NULL,
  message_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_ref text NOT NULL,
  aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  envelope jsonb NOT NULL,
  status text NOT NULL DEFAULT 'STORED_NO_HANDLER'
    CHECK (status IN ('STORED_NO_HANDLER', 'APPLIED', 'ACTION_REQUIRED')),
  result jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (producer, message_id)
);

CREATE TABLE IF NOT EXISTS fleet_delivery.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  message_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_ref text NOT NULL,
  aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
  destination text NOT NULL,
  envelope jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'LEASED', 'PUBLISHED', 'FAILED', 'DEAD')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 100),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX IF NOT EXISTS fleet_delivery_outbox_claim_idx
  ON fleet_delivery.outbox_events (next_attempt_at, created_at)
  WHERE status IN ('PENDING', 'FAILED', 'LEASED');

CREATE TABLE IF NOT EXISTS fleet_delivery.idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  principal_subject text NOT NULL,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('IN_PROGRESS', 'SUCCEEDED', 'FAILED')),
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (tenant_ref, principal_subject, operation, idempotency_key)
);

CREATE TABLE IF NOT EXISTS fleet_delivery.audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_ref text NOT NULL,
  branch_ref text,
  actor_type text NOT NULL,
  actor_ref text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_ref text NOT NULL,
  request_id text NOT NULL,
  correlation_id text,
  outcome text NOT NULL,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE fleet_delivery.inbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_delivery.inbox_events FORCE ROW LEVEL SECURITY;
ALTER TABLE fleet_delivery.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_delivery.outbox_events FORCE ROW LEVEL SECURITY;
ALTER TABLE fleet_delivery.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_delivery.idempotency_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE fleet_delivery.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_delivery.audit_logs FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['inbox_events', 'outbox_events', 'idempotency_keys', 'audit_logs']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON fleet_delivery.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON fleet_delivery.%I USING (tenant_ref = NULLIF(current_setting(''fleet_delivery.tenant_ref'', true), '''')) WITH CHECK (tenant_ref = NULLIF(current_setting(''fleet_delivery.tenant_ref'', true), ''''))',
      table_name
    );
  END LOOP;
END
$$;

GRANT SELECT ON fleet_delivery.integration_mappings TO fleet_delivery_app;
GRANT SELECT ON fleet_delivery.service_principal_revocations TO fleet_delivery_app;
GRANT SELECT, INSERT, UPDATE ON fleet_delivery.inbox_events TO fleet_delivery_app;
GRANT SELECT, INSERT, UPDATE ON fleet_delivery.outbox_events TO fleet_delivery_app;
GRANT SELECT, INSERT, UPDATE ON fleet_delivery.idempotency_keys TO fleet_delivery_app;
GRANT SELECT, INSERT ON fleet_delivery.audit_logs TO fleet_delivery_app;
GRANT USAGE, SELECT ON SEQUENCE fleet_delivery.audit_logs_id_seq TO fleet_delivery_app;

CREATE OR REPLACE FUNCTION fleet_delivery.claim_outbox(
  p_worker text,
  p_limit integer,
  p_lease_seconds integer
)
RETURNS TABLE (
  id uuid,
  tenant_ref text,
  branch_ref text,
  destination text,
  envelope jsonb,
  attempts integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = fleet_delivery, pg_temp
AS $$
  WITH candidates AS (
    SELECT o.id
      FROM fleet_delivery.outbox_events o
     WHERE o.attempts < o.max_attempts
       AND (
         (o.status IN ('PENDING', 'FAILED') AND o.next_attempt_at <= now())
         OR (o.status = 'LEASED' AND o.lease_expires_at < now())
       )
     ORDER BY o.next_attempt_at, o.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  UPDATE fleet_delivery.outbox_events o
     SET status = 'LEASED',
         attempts = o.attempts + 1,
         lease_owner = p_worker,
         lease_expires_at = now() + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 1), 300)),
         last_error_code = NULL,
         last_error_detail = NULL
    FROM candidates c
   WHERE o.id = c.id
  RETURNING o.id, o.tenant_ref, o.branch_ref, o.destination, o.envelope, o.attempts;
$$;

CREATE OR REPLACE FUNCTION fleet_delivery.complete_outbox(p_id uuid, p_worker text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = fleet_delivery, pg_temp
AS $$
  WITH changed AS (
    UPDATE fleet_delivery.outbox_events
       SET status = 'PUBLISHED', published_at = now(), lease_owner = NULL, lease_expires_at = NULL
     WHERE id = p_id AND status = 'LEASED' AND lease_owner = p_worker
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM changed);
$$;

CREATE OR REPLACE FUNCTION fleet_delivery.fail_outbox(
  p_id uuid,
  p_worker text,
  p_error_code text,
  p_error_detail text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = fleet_delivery, pg_temp
AS $$
  WITH changed AS (
    UPDATE fleet_delivery.outbox_events
       SET status = CASE WHEN attempts >= max_attempts THEN 'DEAD' ELSE 'FAILED' END,
           next_attempt_at = now() + make_interval(secs => LEAST(300, (2 ^ LEAST(attempts, 8))::integer)),
           lease_owner = NULL,
           lease_expires_at = NULL,
           last_error_code = left(p_error_code, 100),
           last_error_detail = left(p_error_detail, 1000)
     WHERE id = p_id AND status = 'LEASED' AND lease_owner = p_worker
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM changed);
$$;

REVOKE ALL ON FUNCTION fleet_delivery.claim_outbox(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION fleet_delivery.complete_outbox(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION fleet_delivery.fail_outbox(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fleet_delivery.claim_outbox(text, integer, integer) TO fleet_delivery_worker;
GRANT EXECUTE ON FUNCTION fleet_delivery.complete_outbox(uuid, text) TO fleet_delivery_worker;
GRANT EXECUTE ON FUNCTION fleet_delivery.fail_outbox(uuid, text, text, text) TO fleet_delivery_worker;
