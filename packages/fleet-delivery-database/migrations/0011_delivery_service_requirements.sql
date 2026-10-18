ALTER TABLE fleet_delivery.delivery_quotes
  ADD COLUMN IF NOT EXISTS service_type text DEFAULT 'ON_DEMAND',
  ADD COLUMN IF NOT EXISTS required_vehicle_type text DEFAULT 'MOTORCYCLE',
  ADD COLUMN IF NOT EXISTS required_capacity_kg integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS package_weight_kg numeric(8,2) DEFAULT 1.00,
  ADD COLUMN IF NOT EXISTS package_size_class text DEFAULT 'SMALL',
  ADD COLUMN IF NOT EXISTS special_handling jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS service_requirement_version text DEFAULT 'legacy-synthetic:v1';

ALTER TABLE fleet_delivery.deliveries
  ADD COLUMN IF NOT EXISTS service_type text DEFAULT 'ON_DEMAND',
  ADD COLUMN IF NOT EXISTS required_vehicle_type text DEFAULT 'MOTORCYCLE',
  ADD COLUMN IF NOT EXISTS required_capacity_kg integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS package_weight_kg numeric(8,2) DEFAULT 1.00,
  ADD COLUMN IF NOT EXISTS package_size_class text DEFAULT 'SMALL',
  ADD COLUMN IF NOT EXISTS special_handling jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS service_requirement_version text DEFAULT 'legacy-synthetic:v1';

ALTER TABLE fleet_delivery.delivery_quotes
  ALTER COLUMN service_type SET NOT NULL,
  ALTER COLUMN required_vehicle_type SET NOT NULL,
  ALTER COLUMN required_capacity_kg SET NOT NULL,
  ALTER COLUMN package_weight_kg SET NOT NULL,
  ALTER COLUMN package_size_class SET NOT NULL,
  ALTER COLUMN special_handling SET NOT NULL,
  ALTER COLUMN service_requirement_version SET NOT NULL,
  ALTER COLUMN service_type DROP DEFAULT,
  ALTER COLUMN required_vehicle_type DROP DEFAULT,
  ALTER COLUMN required_capacity_kg DROP DEFAULT,
  ALTER COLUMN package_weight_kg DROP DEFAULT,
  ALTER COLUMN package_size_class DROP DEFAULT,
  ALTER COLUMN special_handling DROP DEFAULT,
  ALTER COLUMN service_requirement_version DROP DEFAULT;

ALTER TABLE fleet_delivery.deliveries
  ALTER COLUMN service_type SET NOT NULL,
  ALTER COLUMN required_vehicle_type SET NOT NULL,
  ALTER COLUMN required_capacity_kg SET NOT NULL,
  ALTER COLUMN package_weight_kg SET NOT NULL,
  ALTER COLUMN package_size_class SET NOT NULL,
  ALTER COLUMN special_handling SET NOT NULL,
  ALTER COLUMN service_requirement_version SET NOT NULL,
  ALTER COLUMN service_type DROP DEFAULT,
  ALTER COLUMN required_vehicle_type DROP DEFAULT,
  ALTER COLUMN required_capacity_kg DROP DEFAULT,
  ALTER COLUMN package_weight_kg DROP DEFAULT,
  ALTER COLUMN package_size_class DROP DEFAULT,
  ALTER COLUMN special_handling DROP DEFAULT,
  ALTER COLUMN service_requirement_version DROP DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='delivery_quotes_service_requirement_check') THEN
    ALTER TABLE fleet_delivery.delivery_quotes ADD CONSTRAINT delivery_quotes_service_requirement_check CHECK (
      service_type='ON_DEMAND'
      AND required_vehicle_type='MOTORCYCLE'
      AND required_capacity_kg BETWEEN 1 AND 500
      AND package_weight_kg > 0 AND package_weight_kg <= 500
      AND required_capacity_kg >= ceil(package_weight_kg)
      AND package_size_class='SMALL'
      AND jsonb_typeof(special_handling)='array'
      AND jsonb_array_length(special_handling)=0
      AND length(service_requirement_version) BETWEEN 1 AND 160
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='deliveries_service_requirement_check') THEN
    ALTER TABLE fleet_delivery.deliveries ADD CONSTRAINT deliveries_service_requirement_check CHECK (
      service_type='ON_DEMAND'
      AND required_vehicle_type='MOTORCYCLE'
      AND required_capacity_kg BETWEEN 1 AND 500
      AND package_weight_kg > 0 AND package_weight_kg <= 500
      AND required_capacity_kg >= ceil(package_weight_kg)
      AND package_size_class='SMALL'
      AND jsonb_typeof(special_handling)='array'
      AND jsonb_array_length(special_handling)=0
      AND length(service_requirement_version) BETWEEN 1 AND 160
    );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION fleet_delivery.protect_delivery_money_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_ref IS DISTINCT FROM OLD.tenant_ref
     OR NEW.branch_ref IS DISTINCT FROM OLD.branch_ref
     OR NEW.bms_order_ref IS DISTINCT FROM OLD.bms_order_ref
     OR NEW.fulfillment_kind IS DISTINCT FROM OLD.fulfillment_kind
     OR NEW.quote_id IS DISTINCT FROM OLD.quote_id
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.gross_delivery_fee_satang IS DISTINCT FROM OLD.gross_delivery_fee_satang
     OR NEW.customer_contribution_satang IS DISTINCT FROM OLD.customer_contribution_satang
     OR NEW.merchant_subsidy_satang IS DISTINCT FROM OLD.merchant_subsidy_satang
     OR NEW.explicit_discount_satang IS DISTINCT FROM OLD.explicit_discount_satang
     OR NEW.commission_bps IS DISTINCT FROM OLD.commission_bps
     OR NEW.commission_satang IS DISTINCT FROM OLD.commission_satang
     OR NEW.service_type IS DISTINCT FROM OLD.service_type
     OR NEW.required_vehicle_type IS DISTINCT FROM OLD.required_vehicle_type
     OR NEW.required_capacity_kg IS DISTINCT FROM OLD.required_capacity_kg
     OR NEW.package_weight_kg IS DISTINCT FROM OLD.package_weight_kg
     OR NEW.package_size_class IS DISTINCT FROM OLD.package_size_class
     OR NEW.special_handling IS DISTINCT FROM OLD.special_handling
     OR NEW.service_requirement_version IS DISTINCT FROM OLD.service_requirement_version
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'delivery financial, authority and service snapshot is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
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
           loc.sequence, loc.accuracy_m, loc.received_at, drv.last_assigned_at,
           v.vehicle_type, v.capacity_kg
      INTO candidate
      FROM fleet_delivery.drivers drv
      JOIN fleet_delivery.driver_memberships m
        ON m.driver_id=drv.id AND m.tenant_ref=drv.tenant_ref AND m.branch_ref=a.branch_ref AND m.active
      JOIN fleet_delivery.driver_vehicles v
        ON v.driver_id=drv.id AND v.tenant_ref=drv.tenant_ref AND v.active AND v.approved
       AND v.vehicle_type=d.required_vehicle_type AND v.capacity_kg >= d.required_capacity_kg
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
      'lastAssignedAt', candidate.last_assigned_at, 'activeWorkload', 0,
      'serviceType', d.service_type, 'requiredVehicleType', d.required_vehicle_type,
      'requiredCapacityKg', d.required_capacity_kg,
      'serviceRequirementVersion', d.service_requirement_version,
      'matchedVehicleType', candidate.vehicle_type, 'matchedVehicleCapacityKg', candidate.capacity_kg
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

REVOKE ALL ON FUNCTION fleet_delivery.advance_dispatch_attempt(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fleet_delivery.advance_dispatch_attempt(uuid, text) TO fleet_delivery_worker;

-- ROLLBACK: stop quote creation and dispatch workers first. Deploy a forward repair that keeps the
-- frozen requirement columns and offer evidence. Removing them is only safe after proving there are
-- no quotes, deliveries or offers created with this migration; history must never be rewritten.
