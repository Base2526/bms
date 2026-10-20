ALTER TABLE fleet_delivery.deliveries DROP CONSTRAINT IF EXISTS deliveries_state_check;
ALTER TABLE fleet_delivery.deliveries ADD CONSTRAINT deliveries_state_check CHECK (state IN (
  'AWAITING_PAYMENT', 'AWAITING_MERCHANT_ACCEPTANCE', 'PREPARING', 'READY_FOR_DISPATCH',
  'SEARCHING_DRIVER', 'OFFERED', 'ASSIGNED', 'EN_ROUTE_PICKUP', 'AT_PICKUP', 'PICKED_UP',
  'IN_TRANSIT', 'AT_DROPOFF', 'DELIVERED', 'COMPLETED', 'DELIVERY_FAILED',
  'RETURN_REQUESTED', 'RETURN_APPROVED', 'RETURN_IN_TRANSIT', 'RETURNED_TO_MERCHANT',
  'RETURN_REVIEW', 'RETURN_RESOLVED', 'MANUAL_DISPATCH_REQUIRED', 'CANCELLED'
));

CREATE TABLE IF NOT EXISTS fleet_delivery.synthetic_pod_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  delivery_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  evidence_ref text NOT NULL CHECK (evidence_ref ~ '^synthetic-photo:[A-Za-z0-9._:-]{8,160}$'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  pixel_width integer NOT NULL CHECK (pixel_width BETWEEN 1 AND 12000),
  pixel_height integer NOT NULL CHECK (pixel_height BETWEEN 1 AND 12000),
  synthetic_only boolean NOT NULL CHECK (synthetic_only = true),
  registered_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (delivery_id, tenant_ref) REFERENCES fleet_delivery.deliveries(id, tenant_ref),
  FOREIGN KEY (assignment_id, tenant_ref) REFERENCES fleet_delivery.driver_assignments(id, tenant_ref),
  UNIQUE (delivery_id),
  UNIQUE (tenant_ref, evidence_ref)
);

CREATE TABLE IF NOT EXISTS fleet_delivery.delivery_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  delivery_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  reason_code text NOT NULL CHECK (reason_code IN (
    'CUSTOMER_UNREACHABLE', 'UNSAFE_DROPOFF', 'ADDRESS_UNRESOLVED', 'DAMAGED', 'OTHER'
  )),
  safety_exception boolean NOT NULL,
  contact_attempt_count integer NOT NULL CHECK (contact_attempt_count = 0),
  synthetic_only boolean NOT NULL CHECK (synthetic_only = true),
  reported_by text NOT NULL,
  reported_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (delivery_id, tenant_ref) REFERENCES fleet_delivery.deliveries(id, tenant_ref),
  FOREIGN KEY (assignment_id, tenant_ref) REFERENCES fleet_delivery.driver_assignments(id, tenant_ref),
  UNIQUE (delivery_id)
);

CREATE TABLE IF NOT EXISTS fleet_delivery.delivery_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  delivery_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN (
    'REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RETURNED_TO_MERCHANT', 'REVIEW', 'RESOLVED'
  )),
  reason_code text NOT NULL,
  synthetic_only boolean NOT NULL CHECK (synthetic_only = true),
  requested_by text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (delivery_id, tenant_ref) REFERENCES fleet_delivery.deliveries(id, tenant_ref),
  UNIQUE (delivery_id),
  UNIQUE (id, tenant_ref)
);

CREATE TABLE IF NOT EXISTS fleet_delivery.delivery_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  delivery_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN (
    'DELIVERY_NOT_RECEIVED', 'DAMAGED', 'RETURN_EXCEPTION', 'FEE_QUESTION', 'OTHER'
  )),
  status text NOT NULL CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED')),
  resolution_code text,
  synthetic_only boolean NOT NULL CHECK (synthetic_only = true),
  opened_by text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_by text,
  resolved_at timestamptz,
  FOREIGN KEY (delivery_id, tenant_ref) REFERENCES fleet_delivery.deliveries(id, tenant_ref),
  CHECK ((status IN ('RESOLVED', 'REJECTED')) = (resolved_at IS NOT NULL)),
  UNIQUE (id, tenant_ref)
);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_one_open_dispute_idx
  ON fleet_delivery.delivery_disputes (delivery_id)
  WHERE status IN ('OPEN', 'UNDER_REVIEW');

CREATE TABLE IF NOT EXISTS fleet_delivery.notification_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  delivery_id uuid NOT NULL,
  delivery_version bigint NOT NULL CHECK (delivery_version > 0),
  audience text NOT NULL CHECK (audience IN ('CUSTOMER', 'DRIVER', 'MERCHANT', 'ADMIN')),
  template_key text NOT NULL CHECK (template_key ~ '^[a-z0-9._:-]{3,120}$'),
  classification text NOT NULL CHECK (classification IN ('OPERATIONAL', 'SAFETY', 'FINANCE')),
  status text NOT NULL CHECK (status = 'SUPPRESSED_NO_APPROVED_PROVIDER'),
  deduplication_key text NOT NULL,
  safe_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (delivery_id, tenant_ref) REFERENCES fleet_delivery.deliveries(id, tenant_ref),
  UNIQUE (tenant_ref, deduplication_key)
);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'synthetic_pod_evidence', 'delivery_failures', 'delivery_returns',
    'delivery_disputes', 'notification_intents'
  ] LOOP
    EXECUTE format('ALTER TABLE fleet_delivery.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE fleet_delivery.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON fleet_delivery.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON fleet_delivery.%I USING (tenant_ref = NULLIF(current_setting(''fleet_delivery.tenant_ref'', true), '''')) WITH CHECK (tenant_ref = NULLIF(current_setting(''fleet_delivery.tenant_ref'', true), ''''))',
      table_name
    );
  END LOOP;
END
$$;

GRANT SELECT, INSERT ON fleet_delivery.synthetic_pod_evidence TO fleet_delivery_app;
GRANT SELECT, INSERT ON fleet_delivery.delivery_failures TO fleet_delivery_app;
GRANT SELECT, INSERT, UPDATE ON fleet_delivery.delivery_returns TO fleet_delivery_app;
GRANT SELECT, INSERT, UPDATE ON fleet_delivery.delivery_disputes TO fleet_delivery_app;
GRANT SELECT, INSERT ON fleet_delivery.notification_intents TO fleet_delivery_app;

-- ROLLBACK: production must remain disabled. Deploy the prior binary, verify no Delivery uses a
-- post-pickup state, then restore the 0013 state constraint. Preserve all lifecycle/evidence tables
-- as append-only audit records; do not delete proof, failure, return, dispute or intent history.
