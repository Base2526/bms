import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  DispatchPolicyV1,
  DriverAvailabilityV1,
  DriverAssignmentQueryV1,
  DriverCurrentAssignmentV1,
  DriverLocationV1,
  DriverOfferFeedQueryV1,
  DriverOfferFeedV1,
  DriverSnapshotV1,
  OfferDecision,
  OfferDecisionV1,
  StartDispatchV1,
  SyntheticDriverV1,
} from "@bms/fleet-delivery-contracts";
import { evaluateDriverLocation, type JsonValue } from "@bms/fleet-delivery-domain";
import {
  beginIdempotent,
  finishIdempotent,
  FleetDeliveryBusinessError,
  type IdempotentResponse,
  writeAudit,
  writeOutbox,
} from "./phase2.js";
import { withTenantReadSnapshot, withTenantTransaction } from "./transaction.js";

type MutationContext = { principal: string; idempotencyKey: string; requestId: string; now?: Date };

export async function listDriverOffers(
  pool: Pool,
  input: DriverOfferFeedQueryV1,
  principal: string,
): Promise<DriverOfferFeedV1> {
  return withTenantTransaction(pool, input.tenantRef, async (client) => {
    const driver = await client.query<{ id: string }>(
      `SELECT d.id
         FROM fleet_delivery.drivers d
         JOIN fleet_delivery.driver_memberships m
           ON m.driver_id=d.id AND m.tenant_ref=d.tenant_ref
          AND m.branch_ref=$3 AND m.active
        WHERE d.tenant_ref=$1 AND d.principal_subject=$2
        LIMIT 1`,
      [input.tenantRef, principal, input.branchRef],
    );
    if (!driver.rows[0]) throw new FleetDeliveryBusinessError("DRIVER_SCOPE_NOT_FOUND", 404);
    const serverNow = new Date();
    const offers = await client.query<{
      id: string;
      delivery_id: string;
      status: "PENDING";
      version: string;
      offered_at: Date;
      expires_at: Date;
      pickup_distance_m: number;
    }>(
      `SELECT id, delivery_id, status, version, offered_at, expires_at, pickup_distance_m
         FROM fleet_delivery.dispatch_offers
        WHERE tenant_ref=$1 AND branch_ref=$2 AND driver_id=$3
          AND status='PENDING' AND expires_at>$4
        ORDER BY expires_at ASC, id ASC
        LIMIT 20`,
      [input.tenantRef, input.branchRef, driver.rows[0].id, serverNow],
    );
    return {
      serverNow: serverNow.toISOString(),
      offers: offers.rows.map((row) => ({
        offerId: row.id,
        deliveryId: row.delivery_id,
        status: row.status,
        version: Number(row.version),
        offeredAt: row.offered_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
        pickupDistanceM: row.pickup_distance_m,
      })),
    };
  });
}

export async function getCurrentDriverAssignment(
  pool: Pool,
  input: DriverAssignmentQueryV1,
  principal: string,
): Promise<DriverCurrentAssignmentV1> {
  return withTenantTransaction(pool, input.tenantRef, async (client) => {
    const driver = await client.query<{ id: string }>(
      `SELECT d.id
         FROM fleet_delivery.drivers d
         JOIN fleet_delivery.driver_memberships m
           ON m.driver_id=d.id AND m.tenant_ref=d.tenant_ref
          AND m.branch_ref=$3 AND m.active
        WHERE d.tenant_ref=$1 AND d.principal_subject=$2
        LIMIT 1`,
      [input.tenantRef, principal, input.branchRef],
    );
    if (!driver.rows[0]) throw new FleetDeliveryBusinessError("DRIVER_SCOPE_NOT_FOUND", 404);
    const serverNow = new Date();
    const assignment = await client.query<{
      id: string;
      delivery_id: string;
      offer_id: string;
      status: "ACTIVE";
      delivery_state: "ASSIGNED" | "EN_ROUTE_PICKUP" | "AT_PICKUP";
      delivery_version: string;
      assigned_at: Date;
    }>(
      `SELECT a.id, a.delivery_id, a.offer_id, a.status,
              d.state AS delivery_state, d.version AS delivery_version, a.assigned_at
         FROM fleet_delivery.driver_assignments a
         JOIN fleet_delivery.deliveries d
           ON d.id=a.delivery_id AND d.tenant_ref=a.tenant_ref AND d.branch_ref=a.branch_ref
        WHERE a.tenant_ref=$1 AND a.branch_ref=$2 AND a.driver_id=$3 AND a.status='ACTIVE'
        LIMIT 1`,
      [input.tenantRef, input.branchRef, driver.rows[0].id],
    );
    const row = assignment.rows[0];
    return {
      serverNow: serverNow.toISOString(),
      assignment: row ? {
        assignmentId: row.id,
        deliveryId: row.delivery_id,
        offerId: row.offer_id,
        status: row.status,
        deliveryState: row.delivery_state,
        deliveryVersion: Number(row.delivery_version),
        assignedAt: row.assigned_at.toISOString(),
      } : null,
    };
  });
}

export async function getDriverSnapshot(
  pool: Pool,
  input: DriverOfferFeedQueryV1,
  principal: string,
): Promise<DriverSnapshotV1> {
  return withTenantReadSnapshot(pool, input.tenantRef, async (client) => {
    const driver = await client.query<{ id: string }>(
      `SELECT d.id
         FROM fleet_delivery.drivers d
         JOIN fleet_delivery.driver_memberships m
           ON m.driver_id=d.id AND m.tenant_ref=d.tenant_ref
          AND m.branch_ref=$3 AND m.active
        WHERE d.tenant_ref=$1 AND d.principal_subject=$2
        LIMIT 1`,
      [input.tenantRef, principal, input.branchRef],
    );
    if (!driver.rows[0]) throw new FleetDeliveryBusinessError("DRIVER_SCOPE_NOT_FOUND", 404);

    const driverId = driver.rows[0].id;
    const serverNow = new Date();
    const availability = await client.query<{
      state: "ONLINE" | "OFFLINE" | "BUSY";
      version: string;
    }>(
      `SELECT state, version
         FROM fleet_delivery.driver_availability
        WHERE tenant_ref=$1 AND branch_ref=$2 AND driver_id=$3`,
      [input.tenantRef, input.branchRef, driverId],
    );
    const assignment = await client.query<{
      id: string;
      delivery_id: string;
      offer_id: string;
      status: "ACTIVE";
      delivery_state: "ASSIGNED" | "EN_ROUTE_PICKUP" | "AT_PICKUP";
      delivery_version: string;
      assigned_at: Date;
    }>(
      `SELECT a.id, a.delivery_id, a.offer_id, a.status,
              d.state AS delivery_state, d.version AS delivery_version, a.assigned_at
         FROM fleet_delivery.driver_assignments a
         JOIN fleet_delivery.deliveries d
           ON d.id=a.delivery_id AND d.tenant_ref=a.tenant_ref AND d.branch_ref=a.branch_ref
        WHERE a.tenant_ref=$1 AND a.branch_ref=$2 AND a.driver_id=$3 AND a.status='ACTIVE'
        LIMIT 1`,
      [input.tenantRef, input.branchRef, driverId],
    );
    const assignmentRow = assignment.rows[0];
    const offers = assignmentRow ? [] : (await client.query<{
      id: string;
      delivery_id: string;
      status: "PENDING";
      version: string;
      offered_at: Date;
      expires_at: Date;
      pickup_distance_m: number;
    }>(
      `SELECT id, delivery_id, status, version, offered_at, expires_at, pickup_distance_m
         FROM fleet_delivery.dispatch_offers
        WHERE tenant_ref=$1 AND branch_ref=$2 AND driver_id=$3
          AND status='PENDING' AND expires_at>$4
        ORDER BY expires_at ASC, id ASC
        LIMIT 20`,
      [input.tenantRef, input.branchRef, driverId, serverNow],
    )).rows;

    return {
      serverNow: serverNow.toISOString(),
      availability: availability.rows[0] ? {
        state: availability.rows[0].state,
        version: Number(availability.rows[0].version),
      } : null,
      assignment: assignmentRow ? {
        assignmentId: assignmentRow.id,
        deliveryId: assignmentRow.delivery_id,
        offerId: assignmentRow.offer_id,
        status: assignmentRow.status,
        deliveryState: assignmentRow.delivery_state,
        deliveryVersion: Number(assignmentRow.delivery_version),
        assignedAt: assignmentRow.assigned_at.toISOString(),
      } : null,
      offers: offers.map((row) => ({
        offerId: row.id,
        deliveryId: row.delivery_id,
        status: row.status,
        version: Number(row.version),
        offeredAt: row.offered_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
        pickupDistanceM: row.pickup_distance_m,
      })),
    };
  });
}

export async function configureDispatchPolicy(
  pool: Pool,
  input: DispatchPolicyV1,
  context: MutationContext,
): Promise<IdempotentResponse> {
  return withTenantTransaction(pool, input.tenantRef, async (client) => {
    const operation = "dispatch.policy.configure.v1";
    const idem = await beginIdempotent(client, {
      tenantRef: input.tenantRef, principal: context.principal, operation,
      key: context.idempotencyKey, request: input as unknown as JsonValue,
    });
    if (idem.replay) return idem.replay;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2 || ':dispatch', 0))", [input.tenantRef, input.branchRef]);
    const latest = await client.query<{ version: string }>(
      `SELECT version FROM fleet_delivery.dispatch_policy_versions
        WHERE tenant_ref=$1 AND branch_ref=$2 ORDER BY version DESC LIMIT 1 FOR UPDATE`,
      [input.tenantRef, input.branchRef],
    );
    if (latest.rows[0] && BigInt(latest.rows[0].version) >= BigInt(input.version)) {
      throw new FleetDeliveryBusinessError("DISPATCH_POLICY_VERSION_STALE", 409);
    }
    await client.query(
      "UPDATE fleet_delivery.dispatch_policy_versions SET active=false WHERE tenant_ref=$1 AND branch_ref=$2 AND active=true",
      [input.tenantRef, input.branchRef],
    );
    const result = await client.query<{ id: string }>(
      `INSERT INTO fleet_delivery.dispatch_policy_versions (
         tenant_ref, branch_ref, version, pickup_point, initial_radius_m, radius_increment_m,
         maximum_radius_m, offer_ttl_seconds, maximum_search_seconds, driver_cooldown_seconds,
         location_freshness_seconds, maximum_location_accuracy_m, batch_size, fairness_mode, created_by
       ) VALUES ($1,$2,$3,ST_SetSRID(ST_MakePoint($4,$5),4326),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [input.tenantRef, input.branchRef, input.version, input.pickup.longitude, input.pickup.latitude,
        input.initialRadiusM, input.radiusIncrementM, input.maximumRadiusM, input.offerTtlSeconds,
        input.maximumSearchSeconds, input.driverCooldownSeconds, input.locationFreshnessSeconds,
        input.maximumLocationAccuracyM, input.batchSize, input.fairnessMode, context.principal],
    );
    const policyId = result.rows[0]!.id;
    await writeAudit(client, {
      tenantRef: input.tenantRef, branchRef: input.branchRef, principal: context.principal,
      action: "dispatch.policy.activated", targetType: "dispatch_policy", targetRef: policyId,
      requestId: context.requestId, metadata: { version: input.version },
    });
    const response = { status: 201, body: { policyId, version: input.version } };
    await finishIdempotent(client, {
      tenantRef: input.tenantRef, principal: context.principal, operation, key: context.idempotencyKey,
    }, response);
    return response;
  });
}

export async function configureSyntheticDriver(
  pool: Pool,
  input: SyntheticDriverV1,
  context: MutationContext,
): Promise<IdempotentResponse> {
  return withTenantTransaction(pool, input.tenantRef, async (client) => {
    const operation = "driver.synthetic.configure.v1";
    const idem = await beginIdempotent(client, {
      tenantRef: input.tenantRef, principal: context.principal, operation,
      key: context.idempotencyKey, request: input as unknown as JsonValue,
    });
    if (idem.replay) return idem.replay;
    const driver = await client.query<{ id: string }>(
      `INSERT INTO fleet_delivery.drivers (
         tenant_ref, driver_ref, principal_subject, verification_status, status, synthetic_only
       ) VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (tenant_ref, driver_ref) DO UPDATE SET
         principal_subject=EXCLUDED.principal_subject,
         verification_status=EXCLUDED.verification_status,
         status=EXCLUDED.status,
         updated_at=now()
       RETURNING id`,
      [input.tenantRef, input.driverRef, input.principalSubject, input.verificationStatus, input.status],
    );
    const driverId = driver.rows[0]!.id;
    await client.query(
      `INSERT INTO fleet_delivery.driver_memberships (tenant_ref, branch_ref, driver_id, active)
       VALUES ($1,$2,$3,true)
       ON CONFLICT (tenant_ref, branch_ref, driver_id) DO UPDATE SET active=true`,
      [input.tenantRef, input.branchRef, driverId],
    );
    const vehicleOwner = await client.query<{ driver_id: string }>(
      `SELECT driver_id FROM fleet_delivery.driver_vehicles
        WHERE tenant_ref=$1 AND vehicle_ref=$2 FOR UPDATE`,
      [input.tenantRef, input.vehicle.vehicleRef],
    );
    if (vehicleOwner.rows[0] && vehicleOwner.rows[0].driver_id !== driverId) {
      throw new FleetDeliveryBusinessError("VEHICLE_ALREADY_ASSIGNED", 409);
    }
    await client.query(
      "UPDATE fleet_delivery.driver_vehicles SET active=false WHERE tenant_ref=$1 AND driver_id=$2 AND active=true AND vehicle_ref<>$3",
      [input.tenantRef, driverId, input.vehicle.vehicleRef],
    );
    await client.query(
      `INSERT INTO fleet_delivery.driver_vehicles (
         tenant_ref, driver_id, vehicle_ref, vehicle_type, capacity_kg, approved, active
       ) VALUES ($1,$2,$3,$4,$5,true,true)
       ON CONFLICT (tenant_ref, vehicle_ref) DO UPDATE SET
         capacity_kg=EXCLUDED.capacity_kg, approved=true, active=true`,
      [input.tenantRef, driverId, input.vehicle.vehicleRef, input.vehicle.type, input.vehicle.capacityKg],
    );
    if (input.status !== "ACTIVE" || input.verificationStatus !== "VERIFIED") {
      await client.query(
        `UPDATE fleet_delivery.driver_availability
            SET state='OFFLINE', version=version+1, changed_at=now()
          WHERE tenant_ref=$1 AND driver_id=$2`,
        [input.tenantRef, driverId],
      );
    }
    await writeAudit(client, {
      tenantRef: input.tenantRef, branchRef: input.branchRef, principal: context.principal,
      action: "driver.synthetic_configured", targetType: "driver", targetRef: driverId,
      requestId: context.requestId,
      metadata: { driverRef: input.driverRef, verificationStatus: input.verificationStatus, status: input.status },
    });
    const response = { status: 201, body: { driverId, driverRef: input.driverRef } };
    await finishIdempotent(client, {
      tenantRef: input.tenantRef, principal: context.principal, operation, key: context.idempotencyKey,
    }, response);
    return response;
  });
}

async function lockDriverPrincipal(
  client: PoolClient,
  principal: string,
  tenantRef: string,
  branchRef: string,
): Promise<{ id: string; status: string; verification_status: string }> {
  const result = await client.query<{ id: string; status: string; verification_status: string }>(
    `SELECT d.id, d.status, d.verification_status
       FROM fleet_delivery.drivers d
       JOIN fleet_delivery.driver_memberships m
         ON m.driver_id=d.id AND m.tenant_ref=d.tenant_ref AND m.branch_ref=$3 AND m.active
      WHERE d.tenant_ref=$1 AND d.principal_subject=$2 FOR UPDATE OF d`,
    [tenantRef, principal, branchRef],
  );
  if (!result.rows[0]) throw new FleetDeliveryBusinessError("DRIVER_SCOPE_NOT_FOUND", 404);
  return result.rows[0];
}

export async function setDriverAvailability(
  pool: Pool,
  input: DriverAvailabilityV1,
  context: MutationContext,
): Promise<IdempotentResponse> {
  return withTenantTransaction(pool, input.tenantRef, async (client) => {
    const operation = "driver.availability.set.v1";
    const idem = await beginIdempotent(client, {
      tenantRef: input.tenantRef, principal: context.principal, operation,
      key: context.idempotencyKey, request: input as unknown as JsonValue,
    });
    if (idem.replay) return idem.replay;
    const driver = await lockDriverPrincipal(client, context.principal, input.tenantRef, input.branchRef);
    if (input.state === "ONLINE" && (driver.status !== "ACTIVE" || driver.verification_status !== "VERIFIED")) {
      throw new FleetDeliveryBusinessError("DRIVER_NOT_ELIGIBLE", 409);
    }
    if (input.state === "ONLINE") {
      const activeAssignment = await client.query(
        "SELECT 1 FROM fleet_delivery.driver_assignments WHERE driver_id=$1 AND status='ACTIVE' LIMIT 1",
        [driver.id],
      );
      if (activeAssignment.rowCount) throw new FleetDeliveryBusinessError("DRIVER_HAS_ACTIVE_ASSIGNMENT", 409);
    }
    const state = input.state;
    const result = await client.query<{ version: string }>(
      `INSERT INTO fleet_delivery.driver_availability (tenant_ref, branch_ref, driver_id, state)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (driver_id) DO UPDATE SET
         branch_ref=EXCLUDED.branch_ref, state=EXCLUDED.state,
         version=fleet_delivery.driver_availability.version+1, changed_at=now()
       RETURNING version`,
      [input.tenantRef, input.branchRef, driver.id, state],
    );
    await writeAudit(client, {
      tenantRef: input.tenantRef, branchRef: input.branchRef, principal: context.principal,
      actorType: "DRIVER",
      action: "driver.availability_changed", targetType: "driver", targetRef: driver.id,
      requestId: context.requestId, metadata: { state },
    });
    const response = { status: 200, body: { state, version: Number(result.rows[0]!.version) } };
    await finishIdempotent(client, {
      tenantRef: input.tenantRef, principal: context.principal, operation, key: context.idempotencyKey,
    }, response);
    return response;
  });
}

export async function recordDriverLocation(
  pool: Pool,
  input: DriverLocationV1,
  context: MutationContext,
): Promise<IdempotentResponse> {
  return withTenantTransaction(pool, input.tenantRef, async (client) => {
    const operation = "driver.location.record.v1";
    const idem = await beginIdempotent(client, {
      tenantRef: input.tenantRef, principal: context.principal, operation,
      key: context.idempotencyKey, request: input as unknown as JsonValue,
    });
    if (idem.replay) return idem.replay;
    const driver = await lockDriverPrincipal(client, context.principal, input.tenantRef, input.branchRef);
    if (driver.status !== "ACTIVE" || driver.verification_status !== "VERIFIED") {
      throw new FleetDeliveryBusinessError("DRIVER_NOT_ELIGIBLE", 409);
    }
    const availability = await client.query<{ state: string }>(
      "SELECT state FROM fleet_delivery.driver_availability WHERE driver_id=$1 AND branch_ref=$2",
      [driver.id, input.branchRef],
    );
    if (!availability.rows[0] || !["ONLINE", "BUSY"].includes(availability.rows[0].state)) {
      throw new FleetDeliveryBusinessError("DRIVER_NOT_AVAILABLE", 409);
    }
    const duplicate = await client.query(
      "SELECT 1 FROM fleet_delivery.driver_locations WHERE driver_id=$1 AND sequence=$2",
      [driver.id, input.sequence],
    );
    if (duplicate.rowCount) throw new FleetDeliveryBusinessError("LOCATION_SEQUENCE_REUSED", 409);
    const previous = await client.query<{
      sequence: string; device_observed_at: Date; distance_m: number;
    }>(
      `SELECT l.sequence, l.device_observed_at,
              ST_Distance(l.location::geography, ST_SetSRID(ST_MakePoint($2,$3),4326)::geography) AS distance_m
         FROM fleet_delivery.driver_locations l
        WHERE l.driver_id=$1 AND l.accepted ORDER BY l.sequence DESC LIMIT 1`,
      [driver.id, input.longitude, input.latitude],
    );
    const prior = previous.rows[0];
    const receivedAt = context.now ?? new Date();
    const decision = evaluateDriverLocation({
      sequence: input.sequence,
      deviceObservedAt: new Date(input.deviceObservedAt),
      receivedAt,
      accuracyM: input.accuracyM,
      mockLocation: input.mockLocation,
      ...(prior ? { previous: {
        sequence: Number(prior.sequence), deviceObservedAt: prior.device_observed_at,
        distanceM: Number(prior.distance_m),
      } } : {}),
    });
    await client.query(
      `INSERT INTO fleet_delivery.driver_locations (
         tenant_ref, branch_ref, driver_id, sequence, location, accuracy_m,
         device_observed_at, received_at, mock_location, accepted, rejection_reason
       ) VALUES ($1,$2,$3,$4,ST_SetSRID(ST_MakePoint($5,$6),4326),$7,$8,$9,$10,$11,$12)`,
      [input.tenantRef, input.branchRef, driver.id, input.sequence, input.longitude, input.latitude,
        input.accuracyM, input.deviceObservedAt, receivedAt, input.mockLocation,
        decision.accepted, decision.reason],
    );
    const response = { status: decision.accepted ? 202 : 422, body: {
      accepted: decision.accepted, rejectionReason: decision.reason, sequence: input.sequence,
    } };
    await finishIdempotent(client, {
      tenantRef: input.tenantRef, principal: context.principal, operation, key: context.idempotencyKey,
    }, response);
    return response;
  });
}

export async function startDispatch(
  pool: Pool,
  deliveryId: string,
  input: StartDispatchV1,
  context: MutationContext,
): Promise<IdempotentResponse> {
  return withTenantTransaction(pool, input.tenantRef, async (client) => {
    const operation = "dispatch.start.v1";
    const request = { deliveryId, ...input } as unknown as JsonValue;
    const idem = await beginIdempotent(client, {
      tenantRef: input.tenantRef, principal: context.principal, operation,
      key: context.idempotencyKey, request,
    });
    if (idem.replay) return idem.replay;
    const delivery = await client.query<{ state: string; version: string }>(
      "SELECT state, version FROM fleet_delivery.deliveries WHERE id=$1 AND tenant_ref=$2 AND branch_ref=$3 FOR UPDATE",
      [deliveryId, input.tenantRef, input.branchRef],
    );
    const row = delivery.rows[0];
    if (!row) throw new FleetDeliveryBusinessError("DELIVERY_NOT_FOUND", 404);
    if (Number(row.version) !== input.expectedVersion) throw new FleetDeliveryBusinessError("DELIVERY_VERSION_CONFLICT", 409);
    if (row.state !== "READY_FOR_DISPATCH") throw new FleetDeliveryBusinessError("DELIVERY_NOT_READY_FOR_DISPATCH", 409);
    const policy = await client.query<{ id: string; initial_radius_m: number; maximum_search_seconds: number }>(
      "SELECT id, initial_radius_m, maximum_search_seconds FROM fleet_delivery.dispatch_policy_versions WHERE tenant_ref=$1 AND branch_ref=$2 AND active=true FOR SHARE",
      [input.tenantRef, input.branchRef],
    );
    if (!policy.rows[0]) throw new FleetDeliveryBusinessError("DISPATCH_POLICY_NOT_FOUND", 409);
    const attemptId = randomUUID();
    const now = context.now ?? new Date();
    await client.query(
      `INSERT INTO fleet_delivery.dispatch_attempts (
         id, tenant_ref, branch_ref, delivery_id, policy_id, status, current_radius_m,
         started_at, search_deadline_at, next_action_at, created_by
       ) VALUES ($1,$2,$3,$4,$5,'SEARCHING',$6,$7,$8,$7,$9)`,
      [attemptId, input.tenantRef, input.branchRef, deliveryId, policy.rows[0].id,
        policy.rows[0].initial_radius_m, now,
        new Date(now.getTime() + policy.rows[0].maximum_search_seconds * 1_000), context.principal],
    );
    const nextVersion = input.expectedVersion + 1;
    await client.query(
      "UPDATE fleet_delivery.deliveries SET state='SEARCHING_DRIVER', version=$2, updated_at=$3 WHERE id=$1",
      [deliveryId, nextVersion, now],
    );
    await client.query(
      `INSERT INTO fleet_delivery.delivery_state_transitions (
         tenant_ref, branch_ref, delivery_id, from_state, to_state, from_version, to_version,
         action, actor_type, actor_ref, reason_code, idempotency_key, request_id, occurred_at
       ) VALUES ($1,$2,$3,'READY_FOR_DISPATCH','SEARCHING_DRIVER',$4,$5,'start_dispatch','SERVICE',$6,
         'DISPATCH_REQUESTED',$7,$8,$9)`,
      [input.tenantRef, input.branchRef, deliveryId, input.expectedVersion, nextVersion,
        context.principal, context.idempotencyKey, context.requestId, now],
    );
    await writeOutbox(client, {
      tenantRef: input.tenantRef, branchRef: input.branchRef,
      messageType: "fleet-delivery.dispatch-started.v1", aggregateType: "delivery",
      aggregateRef: deliveryId, aggregateVersion: nextVersion, correlationId: context.requestId,
      payload: { deliveryId, attemptId, state: "SEARCHING_DRIVER" },
    });
    await writeAudit(client, {
      tenantRef: input.tenantRef, branchRef: input.branchRef, principal: context.principal,
      action: "dispatch.started", targetType: "delivery", targetRef: deliveryId,
      requestId: context.requestId, metadata: { attemptId, policyId: policy.rows[0].id },
    });
    const response = { status: 202, body: { attemptId, deliveryId, state: "SEARCHING_DRIVER", version: nextVersion } };
    await finishIdempotent(client, {
      tenantRef: input.tenantRef, principal: context.principal, operation, key: context.idempotencyKey,
    }, response);
    return response;
  });
}

async function reopenSearch(
  client: PoolClient,
  row: { delivery_id: string; attempt_id: string; branch_ref: string; delivery_state: string; delivery_version: string },
  tenantRef: string,
  context: MutationContext,
  reason: string,
): Promise<void> {
  await client.query(
    "UPDATE fleet_delivery.dispatch_attempts SET next_action_at=now(), updated_at=now() WHERE id=$1 AND status='SEARCHING'",
    [row.attempt_id],
  );
  if (row.delivery_state === "OFFERED") {
    const currentVersion = Number(row.delivery_version);
    await client.query(
      "UPDATE fleet_delivery.deliveries SET state='SEARCHING_DRIVER', version=version+1, updated_at=now() WHERE id=$1",
      [row.delivery_id],
    );
    await client.query(
      `INSERT INTO fleet_delivery.delivery_state_transitions (
         tenant_ref, branch_ref, delivery_id, from_state, to_state, from_version, to_version,
         action, actor_type, actor_ref, reason_code, idempotency_key, request_id
       ) VALUES ($1,$2,$3,'OFFERED','SEARCHING_DRIVER',$4,$5,'offer_decision','DRIVER',$6,$7,$8,$9)`,
      [tenantRef, row.branch_ref, row.delivery_id, currentVersion, currentVersion + 1,
        context.principal, reason, context.idempotencyKey, context.requestId],
    );
    await writeOutbox(client, {
      tenantRef, branchRef: row.branch_ref,
      messageType: "fleet-delivery.delivery-state-changed.v1", aggregateType: "delivery",
      aggregateRef: row.delivery_id, aggregateVersion: currentVersion + 1, correlationId: context.requestId,
      payload: { deliveryId: row.delivery_id, fromState: "OFFERED", toState: "SEARCHING_DRIVER", reasonCode: reason },
    });
  }
}

export async function decideDispatchOffer(
  pool: Pool,
  offerId: string,
  decision: OfferDecision,
  input: OfferDecisionV1,
  context: MutationContext,
): Promise<IdempotentResponse> {
  return withTenantTransaction(pool, input.tenantRef, async (client) => {
    const operation = `dispatch.offer.${decision}.v1`;
    const request = { offerId, decision, ...input } as unknown as JsonValue;
    const idem = await beginIdempotent(client, {
      tenantRef: input.tenantRef, principal: context.principal, operation,
      key: context.idempotencyKey, request,
    });
    if (idem.replay) return idem.replay;
    const result = await client.query<{
      status: string; offer_version: string; expires_at: Date; driver_id: string; driver_status: string;
      verification_status: string; delivery_id: string; attempt_id: string; branch_ref: string;
      delivery_state: string; delivery_version: string; location_received_at: Date | null;
      location_accuracy_m: string | null; freshness_seconds: number; maximum_accuracy_m: number;
    }>(
      `SELECT o.status, o.version AS offer_version, o.expires_at, drv.id AS driver_id,
              drv.status AS driver_status, drv.verification_status, o.delivery_id, o.attempt_id,
              o.branch_ref, dl.state AS delivery_state, dl.version AS delivery_version,
              loc.received_at AS location_received_at, loc.accuracy_m AS location_accuracy_m,
              p.location_freshness_seconds AS freshness_seconds,
              p.maximum_location_accuracy_m AS maximum_accuracy_m
         FROM fleet_delivery.dispatch_offers o
         JOIN fleet_delivery.drivers drv ON drv.id=o.driver_id AND drv.tenant_ref=o.tenant_ref
         JOIN fleet_delivery.driver_memberships m
           ON m.driver_id=drv.id AND m.tenant_ref=drv.tenant_ref AND m.branch_ref=o.branch_ref AND m.active
         JOIN fleet_delivery.dispatch_attempts a ON a.id=o.attempt_id
         JOIN fleet_delivery.dispatch_policy_versions p ON p.id=a.policy_id
         JOIN fleet_delivery.deliveries dl ON dl.id=o.delivery_id
         LEFT JOIN LATERAL (
           SELECT l.received_at, l.accuracy_m FROM fleet_delivery.driver_locations l
            WHERE l.driver_id=drv.id AND l.accepted ORDER BY l.sequence DESC LIMIT 1
         ) loc ON true
        WHERE o.id=$1 AND o.tenant_ref=$2 AND o.branch_ref=$3 AND drv.principal_subject=$4
        FOR UPDATE OF o, dl, a, drv`,
      [offerId, input.tenantRef, input.branchRef, context.principal],
    );
    const row = result.rows[0];
    if (!row) throw new FleetDeliveryBusinessError("OFFER_NOT_FOUND", 404);
    const existingAssignment = await client.query<{ id: string; driver_id: string }>(
      "SELECT id, driver_id FROM fleet_delivery.driver_assignments WHERE delivery_id=$1",
      [row.delivery_id],
    );
    if (row.status === "ACCEPTED" && existingAssignment.rows[0]?.driver_id === row.driver_id) {
      const response = { status: 200, body: {
        offerId, deliveryId: row.delivery_id, assignmentId: existingAssignment.rows[0].id,
        status: "ACCEPTED", authoritativeReplay: true,
      } };
      await finishIdempotent(client, {
        tenantRef: input.tenantRef, principal: context.principal, operation, key: context.idempotencyKey,
      }, response);
      return response;
    }
    if (Number(row.offer_version) !== input.expectedOfferVersion) {
      throw new FleetDeliveryBusinessError("OFFER_VERSION_CONFLICT", 409);
    }
    const now = context.now ?? new Date();
    if (row.status !== "PENDING" || row.expires_at.getTime() <= now.getTime()) {
      if (row.status === "PENDING") {
        await client.query(
          "UPDATE fleet_delivery.dispatch_offers SET status='EXPIRED', version=version+1, decided_at=$2, decision_reason='TTL_EXPIRED' WHERE id=$1",
          [offerId, now],
        );
        await reopenSearch(client, row, input.tenantRef, context, "OFFER_EXPIRED");
      }
      await writeAudit(client, {
        tenantRef: input.tenantRef, branchRef: input.branchRef, principal: context.principal,
        actorType: "DRIVER",
        action: "dispatch.offer_late_decision", targetType: "delivery", targetRef: row.delivery_id,
        requestId: context.requestId, outcome: "DENIED", metadata: { offerId, decision },
      });
      const response = { status: 409, body: {
        error: {
          code: "OFFER_ALREADY_DECIDED",
          message: "Offer is no longer open for a decision",
          retryable: false,
          requestId: context.requestId,
        },
        offerId,
        deliveryId: row.delivery_id,
        winnerAssigned: existingAssignment.rowCount === 1,
        assignmentId: existingAssignment.rows[0]?.id ?? null,
      } };
      await finishIdempotent(client, {
        tenantRef: input.tenantRef, principal: context.principal, operation, key: context.idempotencyKey,
      }, response);
      return response;
    }
    if (decision === "reject") {
      await client.query(
        "UPDATE fleet_delivery.dispatch_offers SET status='REJECTED', version=version+1, decided_at=$2, decision_reason='DRIVER_REJECTED' WHERE id=$1",
        [offerId, now],
      );
      await reopenSearch(client, row, input.tenantRef, context, "OFFER_REJECTED");
      await writeAudit(client, {
        tenantRef: input.tenantRef, branchRef: input.branchRef, principal: context.principal,
        actorType: "DRIVER",
        action: "dispatch.offer_rejected", targetType: "delivery", targetRef: row.delivery_id,
        requestId: context.requestId, metadata: { offerId },
      });
      const response = { status: 200, body: { offerId, deliveryId: row.delivery_id, status: "REJECTED" } };
      await finishIdempotent(client, {
        tenantRef: input.tenantRef, principal: context.principal, operation, key: context.idempotencyKey,
      }, response);
      return response;
    }
    if (row.driver_status !== "ACTIVE" || row.verification_status !== "VERIFIED"
      || !row.location_received_at || row.location_accuracy_m === null
      || now.getTime() - row.location_received_at.getTime() > row.freshness_seconds * 1_000
      || Number(row.location_accuracy_m) > row.maximum_accuracy_m
      || row.delivery_state !== "OFFERED") {
      throw new FleetDeliveryBusinessError("DRIVER_NO_LONGER_ELIGIBLE", 409);
    }
    const availability = await client.query<{ state: string }>(
      "SELECT state FROM fleet_delivery.driver_availability WHERE driver_id=$1 AND branch_ref=$2 FOR UPDATE",
      [row.driver_id, input.branchRef],
    );
    if (availability.rows[0]?.state !== "ONLINE") throw new FleetDeliveryBusinessError("DRIVER_NO_LONGER_ELIGIBLE", 409);
    const assignmentId = randomUUID();
    await client.query(
      `INSERT INTO fleet_delivery.driver_assignments (
         id, tenant_ref, branch_ref, delivery_id, driver_id, offer_id, status, assigned_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7)`,
      [assignmentId, input.tenantRef, input.branchRef, row.delivery_id, row.driver_id, offerId, now],
    );
    await client.query(
      "UPDATE fleet_delivery.dispatch_offers SET status='ACCEPTED', version=version+1, decided_at=$2, decision_reason='DRIVER_ACCEPTED' WHERE id=$1",
      [offerId, now],
    );
    await client.query(
      "UPDATE fleet_delivery.dispatch_attempts SET status='ASSIGNED', lease_owner=null, lease_expires_at=null, updated_at=$2 WHERE id=$1",
      [row.attempt_id, now],
    );
    const currentVersion = Number(row.delivery_version);
    await client.query(
      "UPDATE fleet_delivery.deliveries SET state='ASSIGNED', version=version+1, updated_at=$2 WHERE id=$1",
      [row.delivery_id, now],
    );
    await client.query(
      "UPDATE fleet_delivery.driver_availability SET state='BUSY', version=version+1, changed_at=$2 WHERE driver_id=$1",
      [row.driver_id, now],
    );
    await client.query("UPDATE fleet_delivery.drivers SET last_assigned_at=$2, updated_at=$2 WHERE id=$1", [row.driver_id, now]);
    await client.query(
      `INSERT INTO fleet_delivery.delivery_state_transitions (
         tenant_ref, branch_ref, delivery_id, from_state, to_state, from_version, to_version,
         action, actor_type, actor_ref, reason_code, idempotency_key, request_id, occurred_at
       ) VALUES ($1,$2,$3,'OFFERED','ASSIGNED',$4,$5,'accept_offer','DRIVER',$6,
         'DRIVER_ACCEPTED',$7,$8,$9)`,
      [input.tenantRef, input.branchRef, row.delivery_id, currentVersion, currentVersion + 1,
        context.principal, context.idempotencyKey, context.requestId, now],
    );
    await writeOutbox(client, {
      tenantRef: input.tenantRef, branchRef: input.branchRef,
      messageType: "fleet-delivery.delivery-assigned.v1", aggregateType: "delivery",
      aggregateRef: row.delivery_id, aggregateVersion: currentVersion + 1, correlationId: context.requestId,
      payload: { deliveryId: row.delivery_id, assignmentId, offerId, state: "ASSIGNED" },
    });
    await writeAudit(client, {
      tenantRef: input.tenantRef, branchRef: input.branchRef, principal: context.principal,
      actorType: "DRIVER",
      action: "dispatch.offer_accepted", targetType: "delivery", targetRef: row.delivery_id,
      requestId: context.requestId, metadata: { offerId, assignmentId },
    });
    const response = { status: 200, body: {
      offerId, deliveryId: row.delivery_id, assignmentId, status: "ACCEPTED", authoritativeReplay: false,
    } };
    await finishIdempotent(client, {
      tenantRef: input.tenantRef, principal: context.principal, operation, key: context.idempotencyKey,
    }, response);
    return response;
  });
}

export type ClaimedDispatchAttempt = { id: string; tenantRef: string };

export async function claimDispatchAttempts(
  pool: Pool,
  workerId: string,
  limit: number,
  leaseSeconds: number,
): Promise<ClaimedDispatchAttempt[]> {
  const result = await pool.query<{ id: string; tenant_ref: string }>(
    "SELECT * FROM fleet_delivery.claim_dispatch_attempts($1,$2,$3)",
    [workerId, limit, leaseSeconds],
  );
  return result.rows.map((row) => ({ id: row.id, tenantRef: row.tenant_ref }));
}

export async function advanceDispatchAttempt(
  pool: Pool,
  attemptId: string,
  workerId: string,
): Promise<{ result: string; offerId: string | null; driverId: string | null }> {
  const result = await pool.query<{ result: string; offer_id: string | null; driver_id: string | null }>(
    "SELECT * FROM fleet_delivery.advance_dispatch_attempt($1,$2)",
    [attemptId, workerId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("DISPATCH_ADVANCE_EMPTY_RESULT");
  return { result: row.result, offerId: row.offer_id, driverId: row.driver_id };
}
