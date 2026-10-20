CREATE TABLE IF NOT EXISTS fleet_delivery.customer_grants (
  id uuid PRIMARY KEY,
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  bms_order_ref text NOT NULL,
  order_version bigint NOT NULL CHECK (order_version > 0),
  token_sha256 text NOT NULL CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
  allowed_actions text[] NOT NULL CHECK (
    allowed_actions = ARRAY['QUOTE','CREATE_DELIVERY']::text[]
  ),
  synthetic_only boolean NOT NULL CHECK (synthetic_only = true),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_ref, branch_ref, bms_order_ref, order_version)
    REFERENCES fleet_delivery.order_context_snapshots(tenant_ref, branch_ref, bms_order_ref, order_version),
  UNIQUE (token_sha256),
  UNIQUE (id, tenant_ref),
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX IF NOT EXISTS customer_grants_order_idx
  ON fleet_delivery.customer_grants (tenant_ref, branch_ref, bms_order_ref, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS customer_grants_one_active_order_idx
  ON fleet_delivery.customer_grants (tenant_ref, branch_ref, bms_order_ref)
  WHERE revoked_at IS NULL;

ALTER TABLE fleet_delivery.customer_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_delivery.customer_grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fleet_delivery.customer_grants;
CREATE POLICY tenant_isolation ON fleet_delivery.customer_grants
  USING (tenant_ref = NULLIF(current_setting('fleet_delivery.tenant_ref', true), ''))
  WITH CHECK (tenant_ref = NULLIF(current_setting('fleet_delivery.tenant_ref', true), ''));

CREATE OR REPLACE FUNCTION fleet_delivery.resolve_customer_grant(
  p_token_sha256 text,
  p_required_action text
)
RETURNS TABLE (
  grant_id uuid,
  tenant_ref text,
  branch_ref text,
  bms_order_ref text,
  order_version bigint
)
LANGUAGE sql SECURITY DEFINER
SET search_path = fleet_delivery, pg_temp AS $$
  SELECT g.id, g.tenant_ref, g.branch_ref, g.bms_order_ref, g.order_version
    FROM fleet_delivery.customer_grants g
   WHERE g.token_sha256 = p_token_sha256
     AND g.synthetic_only = true
     AND g.revoked_at IS NULL
     AND g.expires_at > now()
     AND p_required_action = ANY(g.allowed_actions)
   LIMIT 1;
$$;

GRANT SELECT, INSERT, UPDATE ON fleet_delivery.customer_grants TO fleet_delivery_app;
REVOKE ALL ON FUNCTION fleet_delivery.resolve_customer_grant(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fleet_delivery.resolve_customer_grant(text, text) TO fleet_delivery_app;

-- ROLLBACK: disable customer intake first, revoke active grants, and deploy a compatible forward
-- repair. Never expose stored token hashes or delete grant/audit history as an operational rollback.
