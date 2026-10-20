import type { Pool } from "pg";
import type {
  CreateSyntheticDisputeV1,
  DriverJourneyAction,
  DriverJourneyV1,
  ResolveSyntheticDisputeV1,
} from "@bms/fleet-delivery-contracts";
import {
  nextDriverJourneyState,
  type DeliveryState,
  type JsonValue,
} from "@bms/fleet-delivery-domain";
import {
  asSafeNumber,
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

export async function advanceDriverJourney(
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
    const currentVersion = asSafeNumber(row.version);
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
    if (action === "deliver_with_pod" && !input.pod) {
      throw new FleetDeliveryBusinessError("POD_REQUIRED", 422);
    }
    if (action !== "deliver_with_pod" && input.pod) {
      throw new FleetDeliveryBusinessError("POD_NOT_ALLOWED_FOR_ACTION", 422);
    }
    if (action === "report_failure" && !input.failure) {
      throw new FleetDeliveryBusinessError("FAILURE_EVIDENCE_REQUIRED", 422);
    }
    if (action !== "report_failure" && input.failure) {
      throw new FleetDeliveryBusinessError("FAILURE_EVIDENCE_NOT_ALLOWED_FOR_ACTION", 422);
    }

    let evidence: Record<string, JsonValue> = { syntheticOnly: true };
    if (["arrive_pickup", "arrive_dropoff", "arrive_return"].includes(action)) {
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
        driverLocationSequence: asSafeNumber(latest.sequence),
        locationReceivedAt: latest.received_at.toISOString(),
        accuracyM: Number(latest.accuracy_m),
      };
    }

    if (action === "deliver_with_pod") {
      const pod = input.pod!;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO fleet_delivery.synthetic_pod_evidence (
           tenant_ref, branch_ref, delivery_id, assignment_id, evidence_ref, sha256,
           content_type, byte_size, pixel_width, pixel_height, synthetic_only, registered_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11)
         RETURNING id`,
        [input.tenantRef, input.branchRef, deliveryId, row.assignment_id, pod.evidenceRef,
          pod.sha256, pod.contentType, pod.byteSize, pod.pixelWidth, pod.pixelHeight,
          context.principal],
      );
      evidence = {
        syntheticOnly: true,
        podEvidenceId: inserted.rows[0]!.id,
        contentType: pod.contentType,
        byteSize: pod.byteSize,
        sha256: pod.sha256,
      };
    }

    if (action === "report_failure") {
      const failure = input.failure!;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO fleet_delivery.delivery_failures (
           tenant_ref, branch_ref, delivery_id, assignment_id, reason_code, safety_exception,
           contact_attempt_count, synthetic_only, reported_by
         ) VALUES ($1,$2,$3,$4,$5,$6,0,true,$7)
         RETURNING id`,
        [input.tenantRef, input.branchRef, deliveryId, row.assignment_id, failure.reasonCode,
          failure.safetyException, context.principal],
      );
      evidence = {
        syntheticOnly: true,
        failureId: inserted.rows[0]!.id,
        reasonCode: failure.reasonCode,
        safetyException: failure.safetyException,
        contactAttemptCount: 0,
      };
    }

    const nextVersion = currentVersion + 1;
    await client.query(
      `UPDATE fleet_delivery.deliveries
          SET state=$2, version=$3, updated_at=$4,
              terminal_at=CASE WHEN $2 IN ('DELIVERED','RETURNED_TO_MERCHANT') THEN $4 ELSE terminal_at END
        WHERE id=$1`,
      [deliveryId, target, nextVersion, now],
    );
    if (action === "start_return") {
      const updated = await client.query(
        `UPDATE fleet_delivery.delivery_returns
            SET status='IN_TRANSIT', updated_at=$2
          WHERE delivery_id=$1 AND tenant_ref=$3 AND status='APPROVED'`,
        [deliveryId, now, input.tenantRef],
      );
      if (updated.rowCount !== 1) throw new FleetDeliveryBusinessError("RETURN_STATE_CONFLICT", 409);
    } else if (action === "arrive_return") {
      const updated = await client.query(
        `UPDATE fleet_delivery.delivery_returns
            SET status='RETURNED_TO_MERCHANT', updated_at=$2
          WHERE delivery_id=$1 AND tenant_ref=$3 AND status='IN_TRANSIT'`,
        [deliveryId, now, input.tenantRef],
      );
      if (updated.rowCount !== 1) throw new FleetDeliveryBusinessError("RETURN_STATE_CONFLICT", 409);
    }
    if (target === "DELIVERED" || target === "RETURNED_TO_MERCHANT") {
      await client.query(
        `UPDATE fleet_delivery.driver_assignments
            SET status='COMPLETED', ended_at=$2
          WHERE id=$1 AND tenant_ref=$3 AND status='ACTIVE'`,
        [row.assignment_id, now, input.tenantRef],
      );
      await client.query(
        `UPDATE fleet_delivery.driver_availability
            SET state='ONLINE', version=version+1, changed_at=$2
          WHERE driver_id=$1 AND tenant_ref=$3 AND state='BUSY'`,
        [row.driver_id, now, input.tenantRef],
      );
    }
    const reasonCode = `DRIVER_${action.toUpperCase()}`;
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
    await client.query(
      `INSERT INTO fleet_delivery.notification_intents (
         tenant_ref, branch_ref, delivery_id, delivery_version, audience, template_key,
         classification, status, deduplication_key, safe_payload
       ) VALUES ($1,$2,$3,$4,'CUSTOMER',$5,'OPERATIONAL','SUPPRESSED_NO_APPROVED_PROVIDER',$6,$7::jsonb)
       ON CONFLICT (tenant_ref, deduplication_key) DO NOTHING`,
      [input.tenantRef, input.branchRef, deliveryId, nextVersion,
        `delivery.${target.toLowerCase()}`, `customer:${deliveryId}:${nextVersion}`,
        JSON.stringify({ deliveryId, state: target, version: nextVersion })],
    );
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

/** @deprecated Use advanceDriverJourney. Kept for source compatibility with the synthetic Phase 4 slice. */
export const advanceDriverPickupJourney = advanceDriverJourney;

export async function openSyntheticDispute(
  pool: Pool,
  deliveryId: string,
  input: CreateSyntheticDisputeV1,
  context: DriverMutationContext,
): Promise<IdempotentResponse> {
  return withTenantTransaction(pool, input.tenantRef, async (client) => {
    const operation = "delivery.dispute.open.synthetic.v1";
    const request = { deliveryId, ...input } as unknown as JsonValue;
    const idem = await beginIdempotent(client, {
      tenantRef: input.tenantRef,
      principal: context.principal,
      operation,
      key: context.idempotencyKey,
      request,
    });
    if (idem.replay) return idem.replay;
    const delivery = await client.query<{ state: DeliveryState; version: string }>(
      `SELECT state, version
         FROM fleet_delivery.deliveries
        WHERE id=$1 AND tenant_ref=$2 AND branch_ref=$3
        FOR UPDATE`,
      [deliveryId, input.tenantRef, input.branchRef],
    );
    const row = delivery.rows[0];
    if (!row) throw new FleetDeliveryBusinessError("DELIVERY_NOT_FOUND", 404);
    if (asSafeNumber(row.version) !== input.expectedDeliveryVersion) {
      throw new FleetDeliveryBusinessError("DELIVERY_VERSION_CONFLICT", 409);
    }
    if (!["DELIVERED", "COMPLETED", "DELIVERY_FAILED", "RETURN_REQUESTED", "RETURN_APPROVED",
      "RETURN_IN_TRANSIT", "RETURNED_TO_MERCHANT", "RETURN_REVIEW", "RETURN_RESOLVED"].includes(row.state)) {
      throw new FleetDeliveryBusinessError("DISPUTE_NOT_ALLOWED_FOR_STATE", 409);
    }
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM fleet_delivery.delivery_disputes
        WHERE delivery_id=$1 AND tenant_ref=$2 AND status IN ('OPEN','UNDER_REVIEW')
        FOR UPDATE`,
      [deliveryId, input.tenantRef],
    );
    if (existing.rows[0]) throw new FleetDeliveryBusinessError("DELIVERY_DISPUTE_ALREADY_OPEN", 409);
    const now = context.now ?? new Date();
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO fleet_delivery.delivery_disputes (
         tenant_ref, branch_ref, delivery_id, category, status, synthetic_only, opened_by, opened_at
       ) VALUES ($1,$2,$3,$4,'OPEN',true,$5,$6)
       RETURNING id`,
      [input.tenantRef, input.branchRef, deliveryId, input.category, context.principal, now],
    );
    const disputeId = inserted.rows[0]!.id;
    await writeOutbox(client, {
      tenantRef: input.tenantRef,
      branchRef: input.branchRef,
      messageType: "fleet-delivery.dispute-opened.v1",
      aggregateType: "delivery-dispute",
      aggregateRef: disputeId,
      aggregateVersion: 1,
      correlationId: context.requestId,
      payload: { disputeId, deliveryId, category: input.category, syntheticOnly: true },
    });
    await writeAudit(client, {
      tenantRef: input.tenantRef,
      branchRef: input.branchRef,
      principal: context.principal,
      action: "delivery.dispute_opened",
      targetType: "delivery_dispute",
      targetRef: disputeId,
      requestId: context.requestId,
      metadata: { deliveryId, category: input.category, syntheticOnly: true },
    });
    const response = { status: 201, body: { disputeId, deliveryId, status: "OPEN", syntheticOnly: true } };
    await finishIdempotent(client, {
      tenantRef: input.tenantRef,
      principal: context.principal,
      operation,
      key: context.idempotencyKey,
    }, response);
    return response;
  });
}

export async function resolveSyntheticDispute(
  pool: Pool,
  disputeId: string,
  input: ResolveSyntheticDisputeV1,
  context: DriverMutationContext,
): Promise<IdempotentResponse> {
  return withTenantTransaction(pool, input.tenantRef, async (client) => {
    const operation = "delivery.dispute.resolve.synthetic.v1";
    const request = { disputeId, ...input } as unknown as JsonValue;
    const idem = await beginIdempotent(client, {
      tenantRef: input.tenantRef,
      principal: context.principal,
      operation,
      key: context.idempotencyKey,
      request,
    });
    if (idem.replay) return idem.replay;
    const dispute = await client.query<{ delivery_id: string; status: string }>(
      `SELECT delivery_id, status
         FROM fleet_delivery.delivery_disputes
        WHERE id=$1 AND tenant_ref=$2 AND branch_ref=$3
        FOR UPDATE`,
      [disputeId, input.tenantRef, input.branchRef],
    );
    const row = dispute.rows[0];
    if (!row) throw new FleetDeliveryBusinessError("DELIVERY_DISPUTE_NOT_FOUND", 404);
    if (!["OPEN", "UNDER_REVIEW"].includes(row.status)) {
      throw new FleetDeliveryBusinessError("DELIVERY_DISPUTE_ALREADY_DECIDED", 409);
    }
    const now = context.now ?? new Date();
    await client.query(
      `UPDATE fleet_delivery.delivery_disputes
          SET status=$2, resolution_code=$3, resolved_by=$4, resolved_at=$5
        WHERE id=$1`,
      [disputeId, input.decision, input.resolutionCode, context.principal, now],
    );
    await writeOutbox(client, {
      tenantRef: input.tenantRef,
      branchRef: input.branchRef,
      messageType: "fleet-delivery.dispute-resolved.v1",
      aggregateType: "delivery-dispute",
      aggregateRef: disputeId,
      aggregateVersion: 2,
      correlationId: context.requestId,
      payload: {
        disputeId,
        deliveryId: row.delivery_id,
        decision: input.decision,
        resolutionCode: input.resolutionCode,
        syntheticOnly: true,
      },
    });
    await writeAudit(client, {
      tenantRef: input.tenantRef,
      branchRef: input.branchRef,
      principal: context.principal,
      action: "delivery.dispute_resolved",
      targetType: "delivery_dispute",
      targetRef: disputeId,
      requestId: context.requestId,
      metadata: { deliveryId: row.delivery_id, decision: input.decision, resolutionCode: input.resolutionCode },
    });
    const response = {
      status: 200,
      body: { disputeId, deliveryId: row.delivery_id, status: input.decision, syntheticOnly: true },
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
