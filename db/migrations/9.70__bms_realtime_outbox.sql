-- =============================================================
-- 9.70  Transactional realtime outbox
-- -------------------------------------------------------------
-- Business rows and their invalidation event commit together. A separate
-- web/worker dispatcher claims committed rows, performs Redis I/O outside
-- the transaction, then acknowledges with the stable event + claim token.
-- apps/ws never reads this table and never connects to PostgreSQL.
-- =============================================================

CREATE TABLE IF NOT EXISTS bms_realtime_outbox (
  id                BIGSERIAL PRIMARY KEY,
  event_id          UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES bms_tenants(id) ON DELETE CASCADE,
  location_id       UUID,
  user_id           UUID,
  actor_type        TEXT NOT NULL CHECK (actor_type IN (
    'SYSTEM', 'ADMIN', 'USER', 'POS_DEVICE', 'CUSTOMER', 'JOB', 'WEBHOOK'
  )),
  actor_id          UUID,
  device_id         UUID,
  event_type        TEXT NOT NULL CHECK (
    length(event_type) BETWEEN 3 AND 100 AND event_type ~ '^[a-z][a-z0-9_.]+$'
  ),
  schema_version    SMALLINT NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  entity_type       TEXT NOT NULL CHECK (
    length(entity_type) BETWEEN 1 AND 100 AND entity_type ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  ),
  entity_id         TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 128),
  aggregate_version BIGINT CHECK (aggregate_version IS NULL OR aggregate_version >= 0),
  entity_updated_at TIMESTAMPTZ,
  safe_payload      JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(safe_payload) = 'object' AND pg_column_size(safe_payload) <= 16384
  ),
  occurred_at       TIMESTAMPTZ NOT NULL,
  available_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  status            TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED')
  ),
  claimed_at        TIMESTAMPTZ,
  claim_token       UUID,
  published_at      TIMESTAMPTZ,
  attempts          INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error        TEXT CHECK (last_error IS NULL OR length(last_error) <= 500),
  failed_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_bms_realtime_outbox_event UNIQUE (event_id),
  CONSTRAINT ck_bms_realtime_outbox_version CHECK (
    aggregate_version IS NOT NULL OR entity_updated_at IS NOT NULL
  ),
  CONSTRAINT ck_bms_realtime_outbox_claim CHECK (
    (status = 'PROCESSING' AND claimed_at IS NOT NULL AND claim_token IS NOT NULL)
    OR (status <> 'PROCESSING' AND claimed_at IS NULL AND claim_token IS NULL)
  ),
  CONSTRAINT ck_bms_realtime_outbox_terminal CHECK (
    (status = 'PUBLISHED' AND published_at IS NOT NULL AND failed_at IS NULL)
    OR (status = 'FAILED' AND failed_at IS NOT NULL AND published_at IS NULL)
    OR (status IN ('PENDING', 'PROCESSING') AND published_at IS NULL AND failed_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_bms_realtime_outbox_claim
  ON bms_realtime_outbox (available_at, id)
  WHERE status IN ('PENDING', 'PROCESSING') AND published_at IS NULL AND failed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bms_realtime_outbox_tenant_created
  ON bms_realtime_outbox (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bms_realtime_outbox_failed
  ON bms_realtime_outbox (failed_at DESC)
  WHERE status = 'FAILED';

ALTER TABLE bms_realtime_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms_realtime_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bms_realtime_outbox_tenant_isolation ON bms_realtime_outbox;
CREATE POLICY bms_realtime_outbox_tenant_isolation ON bms_realtime_outbox
  USING (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('bms.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON bms_realtime_outbox TO bms_app;
GRANT USAGE, SELECT ON SEQUENCE bms_realtime_outbox_id_seq TO bms_app;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bms_realtime_dispatcher') THEN
    CREATE ROLE bms_realtime_dispatcher NOLOGIN BYPASSRLS;
  ELSE
    ALTER ROLE bms_realtime_dispatcher NOLOGIN BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO bms_realtime_dispatcher;
GRANT SELECT, UPDATE, DELETE ON bms_realtime_outbox TO bms_realtime_dispatcher;

CREATE OR REPLACE FUNCTION public.bms_claim_realtime_outbox(
  p_limit INTEGER,
  p_lease_ms INTEGER
)
RETURNS SETOF public.bms_realtime_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'realtime outbox claim limit must be between 1 and 500';
  END IF;
  IF p_lease_ms < 1000 OR p_lease_ms > 900000 THEN
    RAISE EXCEPTION 'realtime outbox lease must be between 1000 and 900000 milliseconds';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT o.id
      FROM public.bms_realtime_outbox o
     WHERE o.published_at IS NULL
       AND o.failed_at IS NULL
       AND (
         (o.status = 'PENDING' AND o.available_at <= clock_timestamp())
         OR (
           o.status = 'PROCESSING'
           AND o.claimed_at < clock_timestamp() - (p_lease_ms * interval '1 millisecond')
         )
       )
     ORDER BY o.available_at, o.id
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  )
  UPDATE public.bms_realtime_outbox o
     SET status = 'PROCESSING',
         claimed_at = clock_timestamp(),
         claim_token = gen_random_uuid(),
         attempts = o.attempts + 1,
         last_error = NULL
    FROM candidates c
   WHERE o.id = c.id
  RETURNING o.*;
END
$$;

CREATE OR REPLACE FUNCTION public.bms_ack_realtime_outbox(
  p_event_id UUID,
  p_claim_token UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  changed INTEGER;
BEGIN
  UPDATE public.bms_realtime_outbox o
     SET status = 'PUBLISHED',
         published_at = clock_timestamp(),
         claimed_at = NULL,
         claim_token = NULL,
         last_error = NULL
   WHERE o.event_id = p_event_id
     AND o.status = 'PROCESSING'
     AND o.claim_token = p_claim_token;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END
$$;

CREATE OR REPLACE FUNCTION public.bms_nack_realtime_outbox(
  p_event_id UUID,
  p_claim_token UUID,
  p_error TEXT,
  p_max_attempts INTEGER,
  p_base_retry_ms INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  next_status TEXT;
BEGIN
  IF p_max_attempts < 1 OR p_max_attempts > 100 THEN
    RAISE EXCEPTION 'realtime outbox max attempts must be between 1 and 100';
  END IF;
  IF p_base_retry_ms < 100 OR p_base_retry_ms > 60000 THEN
    RAISE EXCEPTION 'realtime outbox base retry must be between 100 and 60000 milliseconds';
  END IF;

  UPDATE public.bms_realtime_outbox o
     SET status = CASE WHEN o.attempts >= p_max_attempts THEN 'FAILED' ELSE 'PENDING' END,
         available_at = CASE
           WHEN o.attempts >= p_max_attempts THEN o.available_at
           ELSE clock_timestamp() + (
             LEAST(3600000::numeric, p_base_retry_ms * power(2::numeric, LEAST(o.attempts - 1, 10)))
             + floor(random() * p_base_retry_ms)
           ) * interval '1 millisecond'
         END,
         failed_at = CASE WHEN o.attempts >= p_max_attempts THEN clock_timestamp() ELSE NULL END,
         claimed_at = NULL,
         claim_token = NULL,
         last_error = left(COALESCE(NULLIF(btrim(p_error), ''), 'publish failed'), 500)
   WHERE o.event_id = p_event_id
     AND o.status = 'PROCESSING'
     AND o.claim_token = p_claim_token
  RETURNING o.status INTO next_status;

  RETURN next_status;
END
$$;

CREATE OR REPLACE FUNCTION public.bms_cleanup_realtime_outbox(
  p_published_retention_seconds INTEGER,
  p_failed_retention_seconds INTEGER
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  changed BIGINT;
BEGIN
  IF p_published_retention_seconds < 86400 OR p_failed_retention_seconds < 86400 THEN
    RAISE EXCEPTION 'realtime outbox retention must be at least one day';
  END IF;

  DELETE FROM public.bms_realtime_outbox o
   WHERE (o.status = 'PUBLISHED' AND o.published_at < clock_timestamp() - (p_published_retention_seconds * interval '1 second'))
      OR (o.status = 'FAILED' AND o.failed_at < clock_timestamp() - (p_failed_retention_seconds * interval '1 second'));
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END
$$;

ALTER FUNCTION public.bms_claim_realtime_outbox(INTEGER, INTEGER) OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_ack_realtime_outbox(UUID, UUID) OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_nack_realtime_outbox(UUID, UUID, TEXT, INTEGER, INTEGER) OWNER TO bms_realtime_dispatcher;
ALTER FUNCTION public.bms_cleanup_realtime_outbox(INTEGER, INTEGER) OWNER TO bms_realtime_dispatcher;

REVOKE ALL ON FUNCTION public.bms_claim_realtime_outbox(INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bms_ack_realtime_outbox(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bms_nack_realtime_outbox(UUID, UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bms_cleanup_realtime_outbox(INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bms_claim_realtime_outbox(INTEGER, INTEGER) TO app;
GRANT EXECUTE ON FUNCTION public.bms_ack_realtime_outbox(UUID, UUID) TO app;
GRANT EXECUTE ON FUNCTION public.bms_nack_realtime_outbox(UUID, UUID, TEXT, INTEGER, INTEGER) TO app;
GRANT EXECUTE ON FUNCTION public.bms_cleanup_realtime_outbox(INTEGER, INTEGER) TO app;

COMMENT ON TABLE bms_realtime_outbox IS
  'Tenant-owned transactional invalidation outbox. Business writes insert here in the same transaction; a database-free WS gateway receives only the Redis result.';
COMMENT ON FUNCTION public.bms_claim_realtime_outbox(INTEGER, INTEGER) IS
  'Claims committed realtime events with a crash-recoverable lease and SKIP LOCKED. Callable only by the trusted app worker role.';
