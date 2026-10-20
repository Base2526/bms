ALTER TABLE fleet_delivery.deliveries DROP CONSTRAINT IF EXISTS deliveries_state_check;
ALTER TABLE fleet_delivery.deliveries ADD CONSTRAINT deliveries_state_check CHECK (state IN (
  'AWAITING_PAYMENT', 'AWAITING_MERCHANT_ACCEPTANCE', 'PREPARING', 'READY_FOR_DISPATCH',
  'SEARCHING_DRIVER', 'OFFERED', 'ASSIGNED', 'MANUAL_DISPATCH_REQUIRED', 'CANCELLED'
));

CREATE TABLE IF NOT EXISTS fleet_delivery.drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  driver_ref text NOT NULL,
  principal_subject text NOT NULL,
  verification_status text NOT NULL CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED')),
  synthetic_only boolean NOT NULL CHECK (synthetic_only = true),
  last_assigned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_ref, driver_ref),
  UNIQUE (principal_subject),
  UNIQUE (id, tenant_ref)
);

CREATE TABLE IF NOT EXISTS fleet_delivery.driver_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  driver_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (driver_id, tenant_ref) REFERENCES fleet_delivery.drivers(id, tenant_ref),
  UNIQUE (tenant_ref, branch_ref, driver_id)
);

CREATE TABLE IF NOT EXISTS fleet_delivery.driver_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  driver_id uuid NOT NULL,
  vehicle_ref text NOT NULL,
  vehicle_type text NOT NULL CHECK (vehicle_type = 'MOTORCYCLE'),
  capacity_kg integer NOT NULL CHECK (capacity_kg BETWEEN 1 AND 500),
  approved boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (driver_id, tenant_ref) REFERENCES fleet_delivery.drivers(id, tenant_ref),
  UNIQUE (tenant_ref, vehicle_ref)
);

CREATE UNIQUE INDEX IF NOT EXISTS driver_one_active_vehicle_idx
  ON fleet_delivery.driver_vehicles (driver_id) WHERE active;

CREATE TABLE IF NOT EXISTS fleet_delivery.driver_availability (
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  driver_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('ONLINE', 'OFFLINE', 'BUSY')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id),
  FOREIGN KEY (driver_id, tenant_ref) REFERENCES fleet_delivery.drivers(id, tenant_ref)
);

CREATE TABLE IF NOT EXISTS fleet_delivery.driver_locations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  driver_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  location geometry(Point, 4326) NOT NULL,
  accuracy_m numeric(8,2) NOT NULL CHECK (accuracy_m > 0),
  device_observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  mock_location boolean NOT NULL,
  accepted boolean NOT NULL,
  rejection_reason text CHECK (rejection_reason IS NULL OR rejection_reason IN (
    'OUT_OF_ORDER', 'STALE', 'FUTURE_TIME', 'INACCURATE', 'MOCK_SIGNAL', 'IMPOSSIBLE_TRAVEL'
  )),
  FOREIGN KEY (driver_id, tenant_ref) REFERENCES fleet_delivery.drivers(id, tenant_ref),
  UNIQUE (driver_id, sequence),
  CHECK (accepted = (rejection_reason IS NULL))
);

CREATE INDEX IF NOT EXISTS driver_locations_latest_idx
  ON fleet_delivery.driver_locations (driver_id, sequence DESC) WHERE accepted;
CREATE INDEX IF NOT EXISTS driver_locations_geometry_idx
  ON fleet_delivery.driver_locations USING gist (location) WHERE accepted;

CREATE TABLE IF NOT EXISTS fleet_delivery.dispatch_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  pickup_point geometry(Point, 4326) NOT NULL,
  initial_radius_m integer NOT NULL CHECK (initial_radius_m BETWEEN 100 AND 50000),
  radius_increment_m integer NOT NULL CHECK (radius_increment_m BETWEEN 100 AND 20000),
  maximum_radius_m integer NOT NULL CHECK (maximum_radius_m BETWEEN initial_radius_m AND 100000),
  offer_ttl_seconds integer NOT NULL CHECK (offer_ttl_seconds BETWEEN 5 AND 300),
  maximum_search_seconds integer NOT NULL CHECK (maximum_search_seconds BETWEEN 10 AND 3600),
  driver_cooldown_seconds integer NOT NULL CHECK (driver_cooldown_seconds BETWEEN 0 AND 3600),
  location_freshness_seconds integer NOT NULL CHECK (location_freshness_seconds BETWEEN 5 AND 300),
  maximum_location_accuracy_m integer NOT NULL CHECK (maximum_location_accuracy_m BETWEEN 5 AND 1000),
  batch_size integer NOT NULL CHECK (batch_size = 1),
  fairness_mode text NOT NULL CHECK (fairness_mode = 'DISTANCE_THEN_LONGEST_IDLE'),
  active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_ref, branch_ref, version),
  UNIQUE (id, tenant_ref)
);

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_policy_one_active_idx
  ON fleet_delivery.dispatch_policy_versions (tenant_ref, branch_ref) WHERE active;

CREATE TABLE IF NOT EXISTS fleet_delivery.dispatch_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  delivery_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('SEARCHING', 'ASSIGNED', 'MANUAL_ESCALATION', 'CANCELLED')),
  round integer NOT NULL DEFAULT 1 CHECK (round > 0),
  current_radius_m integer NOT NULL CHECK (current_radius_m > 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  search_deadline_at timestamptz NOT NULL,
  next_action_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (delivery_id, tenant_ref) REFERENCES fleet_delivery.deliveries(id, tenant_ref),
  FOREIGN KEY (policy_id, tenant_ref) REFERENCES fleet_delivery.dispatch_policy_versions(id, tenant_ref),
  UNIQUE (delivery_id),
  UNIQUE (id, tenant_ref)
);

CREATE INDEX IF NOT EXISTS dispatch_attempt_claim_idx
  ON fleet_delivery.dispatch_attempts (next_action_at, started_at)
  WHERE status = 'SEARCHING';

CREATE TABLE IF NOT EXISTS fleet_delivery.dispatch_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  attempt_id uuid NOT NULL,
  delivery_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  delivery_version bigint NOT NULL CHECK (delivery_version > 0),
  round integer NOT NULL CHECK (round > 0),
  radius_m integer NOT NULL CHECK (radius_m > 0),
  pickup_distance_m integer NOT NULL CHECK (pickup_distance_m >= 0),
  fairness_rank integer NOT NULL CHECK (fairness_rank > 0),
  fairness_evidence jsonb NOT NULL,
  offered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  decision_reason text,
  FOREIGN KEY (attempt_id, tenant_ref) REFERENCES fleet_delivery.dispatch_attempts(id, tenant_ref),
  FOREIGN KEY (delivery_id, tenant_ref) REFERENCES fleet_delivery.deliveries(id, tenant_ref),
  FOREIGN KEY (driver_id, tenant_ref) REFERENCES fleet_delivery.drivers(id, tenant_ref),
  CHECK (expires_at > offered_at),
  CHECK ((status = 'PENDING') = (decided_at IS NULL)),
  UNIQUE (id, tenant_ref)
);

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_offer_one_pending_attempt_idx
  ON fleet_delivery.dispatch_offers (attempt_id) WHERE status = 'PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS dispatch_offer_one_accepted_delivery_idx
  ON fleet_delivery.dispatch_offers (delivery_id) WHERE status = 'ACCEPTED';

CREATE TABLE IF NOT EXISTS fleet_delivery.driver_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  delivery_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  offer_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  FOREIGN KEY (delivery_id, tenant_ref) REFERENCES fleet_delivery.deliveries(id, tenant_ref),
  FOREIGN KEY (driver_id, tenant_ref) REFERENCES fleet_delivery.drivers(id, tenant_ref),
  FOREIGN KEY (offer_id, tenant_ref) REFERENCES fleet_delivery.dispatch_offers(id, tenant_ref),
  UNIQUE (delivery_id),
  UNIQUE (offer_id),
  UNIQUE (id, tenant_ref),
  CHECK ((status = 'ACTIVE') = (ended_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS driver_one_active_assignment_idx
  ON fleet_delivery.driver_assignments (driver_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS fleet_delivery.dispatch_manual_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_ref text NOT NULL,
  branch_ref text NOT NULL,
  attempt_id uuid NOT NULL,
  delivery_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('SEARCH_TIMEOUT', 'NO_ELIGIBLE_DRIVER')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  FOREIGN KEY (attempt_id, tenant_ref) REFERENCES fleet_delivery.dispatch_attempts(id, tenant_ref),
  FOREIGN KEY (delivery_id, tenant_ref) REFERENCES fleet_delivery.deliveries(id, tenant_ref),
  UNIQUE (attempt_id)
);

CREATE OR REPLACE FUNCTION fleet_delivery.reject_driver_location_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'driver locations are append-only' USING ERRCODE = '55000';
END
$$;
DROP TRIGGER IF EXISTS driver_locations_append_only ON fleet_delivery.driver_locations;
CREATE TRIGGER driver_locations_append_only BEFORE UPDATE OR DELETE ON fleet_delivery.driver_locations
  FOR EACH ROW EXECUTE FUNCTION fleet_delivery.reject_driver_location_change();

CREATE OR REPLACE FUNCTION fleet_delivery.protect_dispatch_policy_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'active') IS DISTINCT FROM (to_jsonb(OLD) - 'active')
     OR OLD.active = false OR NEW.active = true THEN
    RAISE EXCEPTION 'dispatch policy versions are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS dispatch_policy_version_immutable ON fleet_delivery.dispatch_policy_versions;
CREATE TRIGGER dispatch_policy_version_immutable BEFORE UPDATE ON fleet_delivery.dispatch_policy_versions
  FOR EACH ROW EXECUTE FUNCTION fleet_delivery.protect_dispatch_policy_version();

CREATE OR REPLACE FUNCTION fleet_delivery.claim_dispatch_attempts(
  p_worker text, p_limit integer, p_lease_seconds integer
)
RETURNS TABLE (id uuid, tenant_ref text)
LANGUAGE sql SECURITY DEFINER SET search_path = fleet_delivery, pg_temp AS $$
  WITH candidates AS (
    SELECT a.id
      FROM fleet_delivery.dispatch_attempts a
     WHERE a.status = 'SEARCHING'
       AND a.next_action_at <= now()
       AND (a.lease_owner IS NULL OR a.lease_expires_at < now())
     ORDER BY a.next_action_at, a.started_at
     FOR UPDATE SKIP LOCKED
     LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  UPDATE fleet_delivery.dispatch_attempts a
     SET lease_owner=p_worker,
         lease_expires_at=now() + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 1), 300)),
         updated_at=now()
    FROM candidates c WHERE a.id=c.id
  RETURNING a.id, a.tenant_ref;
$$;

CREATE OR REPLACE FUNCTION fleet_delivery.record_dispatch_state(
  p_tenant text, p_branch text, p_delivery uuid, p_from text, p_to text,
  p_from_version bigint, p_actor text, p_reason text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = fleet_delivery, pg_temp AS $$
DECLARE message_id uuid := gen_random_uuid();
DECLARE next_version bigint := p_from_version + 1;
BEGIN
  INSERT INTO fleet_delivery.delivery_state_transitions (
    tenant_ref, branch_ref, delivery_id, from_state, to_state, from_version, to_version,
    action, actor_type, actor_ref, reason_code, idempotency_key, request_id
  ) VALUES (
    p_tenant, p_branch, p_delivery, p_from, p_to, p_from_version, next_version,
    'dispatch_worker', 'WORKER', p_actor, p_reason,
    'dispatch:' || p_delivery::text || ':' || next_version::text,
    'dispatch:' || p_delivery::text || ':' || next_version::text
  );
  INSERT INTO fleet_delivery.outbox_events (
    id, tenant_ref, branch_ref, message_type, aggregate_type, aggregate_ref,
    aggregate_version, destination, envelope
  ) VALUES (
    message_id, p_tenant, p_branch, 'fleet-delivery.delivery-state-changed.v1', 'delivery',
    p_delivery::text, next_version, 'synthetic://ack',
    jsonb_build_object(
      'messageId', message_id, 'messageType', 'fleet-delivery.delivery-state-changed.v1',
      'schemaVersion', 1, 'producer', 'fleet-delivery', 'tenantRef', p_tenant,
      'branchRef', p_branch, 'aggregateType', 'delivery', 'aggregateRef', p_delivery::text,
      'aggregateVersion', next_version, 'occurredAt', now(), 'correlationId', message_id,
      'causationId', null, 'payload', jsonb_build_object(
        'deliveryId', p_delivery, 'fromState', p_from, 'toState', p_to, 'reasonCode', p_reason
      )
    )
  );
  INSERT INTO fleet_delivery.audit_logs (
    tenant_ref, branch_ref, actor_type, actor_ref, action, target_type, target_ref,
    request_id, outcome, safe_metadata
  ) VALUES (
    p_tenant, p_branch, 'WORKER', p_actor, 'delivery.dispatch_state_changed',
    'delivery', p_delivery::text, 'dispatch:' || p_delivery::text || ':' || next_version::text,
    'SUCCEEDED', jsonb_build_object('fromState', p_from, 'toState', p_to, 'reasonCode', p_reason)
  );
END
$$;

CREATE OR REPLACE FUNCTION fleet_delivery.advance_dispatch_attempt(p_attempt uuid, p_worker text)
RETURNS TABLE (result text, offer_id uuid, driver_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = fleet_delivery, pg_temp AS $$
DECLARE a record;
DECLARE d record;
DECLARE p record;
DECLARE candidate record;
DECLARE candidate_found boolean := false;
DECLARE pending_offer record;
DECLARE new_offer_id uuid;
DECLARE next_version bigint;
DECLARE escalation_reason text;
BEGIN
  SELECT * INTO a FROM fleet_delivery.dispatch_attempts
   WHERE id=p_attempt AND status='SEARCHING' FOR UPDATE;
  IF NOT FOUND OR a.lease_owner IS DISTINCT FROM p_worker OR a.lease_expires_at <= now() THEN
    RETURN QUERY SELECT 'LEASE_LOST'::text, null::uuid, null::uuid;
    RETURN;
  END IF;
  SELECT * INTO d FROM fleet_delivery.deliveries WHERE id=a.delivery_id FOR UPDATE;
  SELECT * INTO p FROM fleet_delivery.dispatch_policy_versions WHERE id=a.policy_id;

  SELECT * INTO pending_offer FROM fleet_delivery.dispatch_offers
   WHERE attempt_id=a.id AND status='PENDING' FOR UPDATE;
  IF FOUND AND pending_offer.expires_at > now() THEN
    UPDATE fleet_delivery.dispatch_attempts
       SET lease_owner=null, lease_expires_at=null, next_action_at=pending_offer.expires_at, updated_at=now()
     WHERE id=a.id;
    RETURN QUERY SELECT 'WAITING'::text, pending_offer.id, pending_offer.driver_id;
    RETURN;
  ELSIF FOUND THEN
    UPDATE fleet_delivery.dispatch_offers
       SET status='EXPIRED', version=version+1, decided_at=now(), decision_reason='TTL_EXPIRED'
     WHERE id=pending_offer.id;
    IF d.state='OFFERED' THEN
      UPDATE fleet_delivery.deliveries SET state='SEARCHING_DRIVER', version=version+1, updated_at=now() WHERE id=d.id;
      PERFORM fleet_delivery.record_dispatch_state(a.tenant_ref, a.branch_ref, d.id, 'OFFERED', 'SEARCHING_DRIVER', d.version, p_worker, 'OFFER_EXPIRED');
      d.state := 'SEARCHING_DRIVER'; d.version := d.version + 1;
    END IF;
  END IF;

  IF now() >= a.search_deadline_at THEN escalation_reason := 'SEARCH_TIMEOUT'; END IF;
  IF escalation_reason IS NULL THEN
    SELECT drv.id,
           round(public.ST_Distance(loc.location::public.geography, p.pickup_point::public.geography))::integer AS distance_m,
           loc.sequence, loc.accuracy_m, loc.received_at, drv.last_assigned_at
      INTO candidate
      FROM fleet_delivery.drivers drv
      JOIN fleet_delivery.driver_memberships m
        ON m.driver_id=drv.id AND m.tenant_ref=drv.tenant_ref AND m.branch_ref=a.branch_ref AND m.active
      JOIN fleet_delivery.driver_vehicles v
        ON v.driver_id=drv.id AND v.tenant_ref=drv.tenant_ref AND v.active AND v.approved
      JOIN fleet_delivery.driver_availability av
        ON av.driver_id=drv.id AND av.tenant_ref=drv.tenant_ref AND av.branch_ref=a.branch_ref AND av.state='ONLINE'
      JOIN LATERAL (
        SELECT l.* FROM fleet_delivery.driver_locations l
         WHERE l.driver_id=drv.id AND l.tenant_ref=drv.tenant_ref AND l.accepted
         ORDER BY l.sequence DESC LIMIT 1
      ) loc ON true
     WHERE drv.tenant_ref=a.tenant_ref AND drv.status='ACTIVE' AND drv.verification_status='VERIFIED'
       AND loc.received_at >= now() - make_interval(secs => p.location_freshness_seconds)
       AND loc.accuracy_m <= p.maximum_location_accuracy_m
       AND public.ST_DWithin(loc.location::public.geography, p.pickup_point::public.geography, a.current_radius_m)
       AND NOT EXISTS (
         SELECT 1 FROM fleet_delivery.driver_assignments x WHERE x.driver_id=drv.id AND x.status='ACTIVE'
       )
       AND NOT EXISTS (
         SELECT 1 FROM fleet_delivery.dispatch_offers o
          WHERE o.driver_id=drv.id AND o.offered_at > now() - make_interval(secs => p.driver_cooldown_seconds)
       )
     ORDER BY public.ST_Distance(loc.location::public.geography, p.pickup_point::public.geography),
              drv.last_assigned_at ASC NULLS FIRST, drv.id
     LIMIT 1;
    candidate_found := FOUND;
  END IF;

  IF escalation_reason IS NULL AND NOT candidate_found THEN
    IF a.current_radius_m < p.maximum_radius_m THEN
      UPDATE fleet_delivery.dispatch_attempts
         SET current_radius_m=LEAST(p.maximum_radius_m, a.current_radius_m+p.radius_increment_m),
             round=a.round+1, next_action_at=now(), lease_owner=null, lease_expires_at=null, updated_at=now()
       WHERE id=a.id;
      RETURN QUERY SELECT 'RADIUS_EXPANDED'::text, null::uuid, null::uuid;
      RETURN;
    END IF;
    escalation_reason := 'NO_ELIGIBLE_DRIVER';
  END IF;

  IF escalation_reason IS NOT NULL THEN
    UPDATE fleet_delivery.dispatch_attempts
       SET status='MANUAL_ESCALATION', lease_owner=null, lease_expires_at=null, updated_at=now()
     WHERE id=a.id;
    INSERT INTO fleet_delivery.dispatch_manual_queue (
      tenant_ref, branch_ref, attempt_id, delivery_id, reason
    ) VALUES (a.tenant_ref, a.branch_ref, a.id, a.delivery_id, escalation_reason)
    ON CONFLICT (attempt_id) DO NOTHING;
    IF d.state <> 'MANUAL_DISPATCH_REQUIRED' THEN
      UPDATE fleet_delivery.deliveries
         SET state='MANUAL_DISPATCH_REQUIRED', version=version+1, updated_at=now()
       WHERE id=d.id;
      PERFORM fleet_delivery.record_dispatch_state(a.tenant_ref, a.branch_ref, d.id, d.state, 'MANUAL_DISPATCH_REQUIRED', d.version, p_worker, escalation_reason);
    END IF;
    RETURN QUERY SELECT 'MANUAL_ESCALATION'::text, null::uuid, null::uuid;
    RETURN;
  END IF;

  IF d.state='SEARCHING_DRIVER' THEN
    UPDATE fleet_delivery.deliveries SET state='OFFERED', version=version+1, updated_at=now() WHERE id=d.id;
    PERFORM fleet_delivery.record_dispatch_state(a.tenant_ref, a.branch_ref, d.id, 'SEARCHING_DRIVER', 'OFFERED', d.version, p_worker, 'OFFER_CREATED');
    next_version := d.version + 1;
  ELSE
    next_version := d.version;
  END IF;
  new_offer_id := gen_random_uuid();
  INSERT INTO fleet_delivery.dispatch_offers (
    id, tenant_ref, branch_ref, attempt_id, delivery_id, driver_id, status, delivery_version,
    round, radius_m, pickup_distance_m, fairness_rank, fairness_evidence, expires_at
  ) VALUES (
    new_offer_id, a.tenant_ref, a.branch_ref, a.id, a.delivery_id, candidate.id, 'PENDING', next_version,
    a.round, a.current_radius_m, candidate.distance_m, 1,
    jsonb_build_object(
      'policyVersion', p.version, 'fairnessMode', p.fairness_mode,
      'pickupDistanceM', candidate.distance_m, 'locationSequence', candidate.sequence,
      'locationAccuracyM', candidate.accuracy_m, 'locationReceivedAt', candidate.received_at,
      'lastAssignedAt', candidate.last_assigned_at, 'activeWorkload', 0
    ),
    now() + make_interval(secs => p.offer_ttl_seconds)
  );
  UPDATE fleet_delivery.dispatch_attempts
     SET next_action_at=now() + make_interval(secs => p.offer_ttl_seconds),
         lease_owner=null, lease_expires_at=null, updated_at=now()
   WHERE id=a.id;
  RETURN QUERY SELECT 'OFFERED'::text, new_offer_id, candidate.id;
END
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'drivers', 'driver_memberships', 'driver_vehicles', 'driver_availability', 'driver_locations',
    'dispatch_policy_versions', 'dispatch_attempts', 'dispatch_offers', 'driver_assignments',
    'dispatch_manual_queue'
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

GRANT SELECT, INSERT, UPDATE ON fleet_delivery.drivers TO fleet_delivery_app;
GRANT SELECT, INSERT, UPDATE ON fleet_delivery.driver_memberships TO fleet_delivery_app;
GRANT SELECT, INSERT, UPDATE ON fleet_delivery.driver_vehicles TO fleet_delivery_app;
GRANT SELECT, INSERT, UPDATE ON fleet_delivery.driver_availability TO fleet_delivery_app;
GRANT SELECT, INSERT ON fleet_delivery.driver_locations TO fleet_delivery_app;
GRANT USAGE, SELECT ON SEQUENCE fleet_delivery.driver_locations_id_seq TO fleet_delivery_app;
GRANT SELECT, INSERT, UPDATE ON fleet_delivery.dispatch_policy_versions TO fleet_delivery_app;
GRANT SELECT, INSERT, UPDATE ON fleet_delivery.dispatch_attempts TO fleet_delivery_app;
GRANT SELECT, INSERT, UPDATE ON fleet_delivery.dispatch_offers TO fleet_delivery_app;
GRANT SELECT, INSERT, UPDATE ON fleet_delivery.driver_assignments TO fleet_delivery_app;
GRANT SELECT, INSERT, UPDATE ON fleet_delivery.dispatch_manual_queue TO fleet_delivery_app;

REVOKE ALL ON FUNCTION fleet_delivery.claim_dispatch_attempts(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION fleet_delivery.advance_dispatch_attempt(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION fleet_delivery.record_dispatch_state(text, text, uuid, text, text, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fleet_delivery.claim_dispatch_attempts(text, integer, integer) TO fleet_delivery_worker;
GRANT EXECUTE ON FUNCTION fleet_delivery.advance_dispatch_attempt(uuid, text) TO fleet_delivery_worker;
