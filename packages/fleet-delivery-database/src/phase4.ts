import type { Pool } from "pg";
import type {
  DriverJourneyAction,
  DriverJourneyV1,
} from "@bms/fleet-delivery-contracts";
import {
  nextDriverJourneyState,
  type DeliveryState,
  type JsonValue,
} from "@bms/fleet-delivery-domain";
import {
  beginIdempotent,
  finishIdempotent,
  FleetDeliveryBusinessError,
  type IdempotentResponse,
  writeAudit,
  writeOutbox,
} from "./phase2.js";
import { withTenantTransaction } from "./transaction.js";

type DriverMutationContext = {
  principal: string;
  idempotencyKey: string;
  requestId: string;
  now?: Date;
};

export async function advanceDriverPickupJourney(
  pool: Pool,
  deliveryId: string,
  action: DriverJourneyAction,
  input: DriverJourneyV1,
  context: DriverMutationContext,
): Promise<IdempotentResponse> {
  return withTenantTransaction(pool, input.tenantRef, async (client) => {
    const operation = `driver.journey.${action}.v1`;
    const request = { deliveryId, action, ...input } as unknown as JsonValue;
    const idem = await beginIdempotent(client, {
      tenantRef: input.tenantRef,
      principal: context.principal,
      operation,
      key: context.idempotencyKey,
      request,
    });
    if (idem.replay) return idem.replay;

    const assignment = await client.query<{
      state: DeliveryState;
      version: string;
      assignment_id: string;
      driver_id: string;
      driver_status: string;
      verification_status: string;
      location_freshness_seconds: number;
      maximum_location_accuracy_m: number;
    }>(
      `SELECT d.state, d.version, a.id AS assignment_id, drv.id AS driver_id,
              drv.status AS driver_status, drv.verification_status,
              p.location_freshness_seconds, p.maximum_location_accuracy_m
         FROM fleet_delivery.deliveries d
         JOIN fleet_delivery.driver_assignments a
           ON a.delivery_id=d.id AND a.tenant_ref=d.tenant_ref
          AND a.branch_ref=d.branch_ref AND a.status='ACTIVE'
         JOIN fleet_delivery.drivers drv
           ON drv.id=a.driver_id AND drv.tenant_ref=a.tenant_ref
         JOIN fleet_delivery.driver_memberships m
           ON m.driver_id=drv.id AND m.tenant_ref=drv.tenant_ref
          AND m.branch_ref=d.branch_ref AND m.active
         JOIN fleet_delivery.dispatch_offers o
           ON o.id=a.offer_id AND o.tenant_ref=a.tenant_ref
         JOIN fleet_delivery.dispatch_attempts da
           ON da.id=o.attempt_id AND da.tenant_ref=o.tenant_ref
         JOIN fleet_delivery.dispatch_policy_versions p
           ON p.id=da.policy_id AND p.tenant_ref=da.tenant_ref
        WHERE d.id=$1 AND d.tenant_ref=$2 AND d.branch_ref=$3
          AND drv.principal_subject=$4
        FOR UPDATE OF d, a, drv`,
      [deliveryId, input.tenantRef, input.branchRef, context.principal],
    );
    const row = assignment.rows[0];
    if (!row) throw new FleetDeliveryBusinessError("DRIVER_ASSIGNMENT_NOT_FOUND", 404);
    if (row.driver_status !== "ACTIVE" || row.verification_status !== "VERIFIED") {
      throw new FleetDeliveryBusinessError("DRIVER_NOT_ELIGIBLE", 409);
    }
    const currentVersion = Number(row.version);
    if (currentVersion !== input.expectedVersion) {
      throw new FleetDeliveryBusinessError("DELIVERY_VERSION_CONFLICT", 409);
    }
    let target: DeliveryState;
    try {
      target = nextDriverJourneyState(row.state, action);
    } catch {
      throw new FleetDeliveryBusinessError("INVALID_DRIVER_JOURNEY_TRANSITION", 409);
    }

    const now = context.now ?? new Date();
    let evidence: Record<string, JsonValue> = { syntheticOnly: true };
    if (action === "arrive_pickup") {
      const location = await client.query<{
        sequence: string;
        received_at: Date;
        accuracy_m: string;
      }>(
        `SELECT sequence, received_at, accuracy_m
           FROM fleet_delivery.driver_locations
          WHERE tenant_ref=$1 AND branch_ref=$2 AND driver_id=$3 AND accepted
          ORDER BY sequence DESC
          LIMIT 1`,
        [input.tenantRef, input.branchRef, row.driver_id],
      );
      const latest = location.rows[0];
      const ageMs = latest ? now.getTime() - latest.received_at.getTime() : Number.POSITIVE_INFINITY;
      if (!latest || ageMs < -30_000
        || ageMs > row.location_freshness_seconds * 1_000
        || Number(latest.accuracy_m) > row.maximum_location_accuracy_m) {
        throw new FleetDeliveryBusinessError("ARRIVAL_LOCATION_REQUIRED", 409);
      }
      evidence = {
        syntheticOnly: true,
        driverLocationSequence: Number(latest.sequence),
        locationReceivedAt: latest.received_at.toISOString(),
        accuracyM: Number(latest.accuracy_m),
      };
    }

    const nextVersion = currentVersion + 1;
    await client.query(
      "UPDATE fleet_delivery.deliveries SET state=$2, version=$3, updated_at=$4 WHERE id=$1",
      [deliveryId, target, nextVersion, now],
    );
    const reasonCode = action === "start_pickup" ? "DRIVER_STARTED_PICKUP" : "DRIVER_ARRIVED_PICKUP";
    await client.query(
      `INSERT INTO fleet_delivery.delivery_state_transitions (
         tenant_ref, branch_ref, delivery_id, from_state, to_state, from_version, to_version,
         action, actor_type, actor_ref, reason_code, idempotency_key, request_id, occurred_at, evidence
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'DRIVER',$9,$10,$11,$12,$13,$14::jsonb)`,
      [input.tenantRef, input.branchRef, deliveryId, row.state, target, currentVersion, nextVersion,
        action, context.principal, reasonCode, context.idempotencyKey, context.requestId, now,
        JSON.stringify(evidence)],
    );
    await writeOutbox(client, {
      tenantRef: input.tenantRef,
      branchRef: input.branchRef,
      messageType: "fleet-delivery.delivery-state-changed.v1",
      aggregateType: "delivery",
      aggregateRef: deliveryId,
      aggregateVersion: nextVersion,
      correlationId: context.requestId,
      payload: {
        deliveryId,
        assignmentId: row.assignment_id,
        fromState: row.state,
        toState: target,
        action,
        reasonCode,
      },
    });
    await writeAudit(client, {
      tenantRef: input.tenantRef,
      branchRef: input.branchRef,
      principal: context.principal,
      actorType: "DRIVER",
      action: `driver.journey.${action}`,
      targetType: "delivery",
      targetRef: deliveryId,
      requestId: context.requestId,
      metadata: { assignmentId: row.assignment_id, fromState: row.state, toState: target, ...evidence },
    });
    const response = {
      status: 200,
      body: { deliveryId, assignmentId: row.assignment_id, state: target, version: nextVersion, evidence },
    };
    await finishIdempotent(client, {
      tenantRef: input.tenantRef,
      principal: context.principal,
      operation,
      key: context.idempotencyKey,
    }, response);
    return response;
  });
}
