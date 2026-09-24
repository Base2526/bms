import { createHash } from "node:crypto";

import { getClient } from "@/lib/db";
import { shipOrderInTx } from "../orders";
import { beginTenantTx } from "../tenant";
import { enqueueRealtimeEventInTx, realtimeEvent } from "../realtimeOutbox";
import { DELIVERY_CAPABILITIES } from "./capabilities";
import { enqueueDeliveryCommandInTx } from "./commands";
import { foodpandaCommandForLocalTransition } from "./transportLifecycle";
import type { DeliveryProvider, DeliveryTransportType } from "./types";

const HANDOFF_CHECKS = ["foodComplete", "drinksComplete", "condimentsComplete", "bagCountCorrect", "bagSealed", "orderNumberMatched"] as const;
type HandoffCheck = (typeof HANDOFF_CHECKS)[number];

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function commandKey(prefix: string, value: string) {
  return `${prefix}:${digest(value)}`;
}

async function hasPermissionInTx(client: { query: Function }, tenantId: string, userId: string, permission: string) {
  const result = await client.query(
    `SELECT CASE WHEN r.name = 'Administrator' THEN TRUE ELSE EXISTS (
       SELECT 1 FROM bms_role_permissions rp
        WHERE rp.tenant_id = $1 AND rp.role_id = u.role_id AND rp.permission = $3
     ) END AS allowed
       FROM users u LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.tenant_id = $1 AND u.id = $2`,
    [tenantId, userId, permission],
  );
  return Boolean(result.rows[0]?.allowed);
}

function validateKey(value: string) {
  return value.length >= 8 && value.length <= 200;
}

export async function markDeliveryOrderReady(input: {
  tenantId: string;
  locationId: string;
  orderId: string;
  actorUserId: string;
  deviceId: string;
  idempotencyKey: string;
}) {
  const key = input.idempotencyKey.trim();
  if (!validateKey(key)) return { status: "INVALID_IDEMPOTENCY_KEY" as const };
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    if (!(await hasPermissionInTx(client, input.tenantId, input.actorUserId, "restaurant.kitchen.update"))) {
      await client.query("ROLLBACK");
      return { status: "FORBIDDEN" as const };
    }
    const row = await client.query<{
      id: string; integration_id: string; provider: DeliveryProvider; provider_order_id: string;
      provider_store_id: string; local_status: string; order_status: string;
      rollout_mode: string; outbound_commands_enabled: boolean; transport_type: DeliveryTransportType | null;
    }>(
      `SELECT d.id, d.integration_id, d.provider, d.provider_order_id,
              lm.provider_store_id, d.local_status, o.status AS order_status,
              i.rollout_mode, i.outbound_commands_enabled, d.transport_type
         FROM bms_delivery_orders d
         JOIN bms_orders o ON o.tenant_id = d.tenant_id AND o.id = d.bms_order_id
         JOIN bms_delivery_integrations i ON i.tenant_id=d.tenant_id AND i.id=d.integration_id
         JOIN bms_delivery_location_mappings lm
           ON lm.tenant_id = d.tenant_id AND lm.integration_id = d.integration_id
          AND lm.id = d.location_mapping_id AND lm.location_id = d.location_id AND lm.active
        WHERE d.tenant_id = $1 AND d.location_id = $2 AND d.bms_order_id = $3
        FOR UPDATE OF d, o`,
      [input.tenantId, input.locationId, input.orderId],
    );
    const order = row.rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      return { status: "NOT_FOUND" as const };
    }
    const foodpandaReady = order.provider === "FOODPANDA"
      ? foodpandaCommandForLocalTransition(order.transport_type, "READY") : null;
    if (foodpandaReady && !foodpandaReady.ok) {
      await client.query("ROLLBACK");
      return { status: "TRANSPORT_TYPE_REQUIRED" as const };
    }
    if (order.local_status === "READY" || order.local_status === "HANDED_OVER" || order.local_status === "COMPLETED") {
      await client.query("COMMIT");
      return { status: "READY" as const, replayed: true };
    }
    if (order.order_status !== "PACKING" || !["ACCEPTED", "PREPARING"].includes(order.local_status)) {
      await client.query("ROLLBACK");
      return { status: "INVALID_STATUS" as const, current: order.local_status };
    }
    const unfinished = await client.query(
      `SELECT 1 FROM bms_kitchen_tickets
        WHERE tenant_id = $1 AND order_id = $2 AND status IN ('NEW','PREPARING') LIMIT 1`,
      [input.tenantId, input.orderId],
    );
    if (unfinished.rowCount) {
      await client.query("ROLLBACK");
      return { status: "KITCHEN_NOT_READY" as const };
    }
    await client.query(
      `UPDATE bms_delivery_orders SET local_status = 'READY', ready_at = COALESCE(ready_at, now()), updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [input.tenantId, order.id],
    );
    const shouldNotifyReady = order.provider !== "FOODPANDA"
      || (foodpandaReady?.ok && foodpandaReady.commandType === "MARK_READY");
    let providerCommandId: string | null = null;
    if (shouldNotifyReady) {
      const providerCommandReady = DELIVERY_CAPABILITIES[order.provider].markReady === "VERIFIED"
        && order.rollout_mode === "LIVE" && order.outbound_commands_enabled;
      const command = await enqueueDeliveryCommandInTx(client, {
        tenantId: input.tenantId,
        integrationId: order.integration_id,
        deliveryOrderId: order.id,
        commandType: "MARK_READY",
        aggregateType: "delivery_order",
        aggregateId: order.id,
        desiredState: { providerOrderId: order.provider_order_id, providerStoreId: order.provider_store_id },
        idempotencyKey: commandKey("ready", key),
        initialStatus: providerCommandReady ? "PENDING" : "MANUAL_ACTION_REQUIRED",
      });
      providerCommandId = command.id;
    }
    await client.query(
      `INSERT INTO bms_delivery_order_events
         (tenant_id, delivery_order_id, event_kind, actor_type, actor_id, source, safe_detail)
       VALUES ($1,$2,'ORDER_READY','POS_DEVICE',$3,'POS',$4::jsonb)`,
      [input.tenantId, order.id, input.actorUserId, JSON.stringify({ deviceId: input.deviceId, idempotencyHash: digest(key) })],
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'restaurant.delivery_ready',$3,$4::jsonb)`,
      [input.tenantId, input.actorUserId, order.id, JSON.stringify({ locationId: input.locationId, providerCommandId })],
    );
    const readyAt = new Date().toISOString();
    await enqueueRealtimeEventInTx(client, realtimeEvent({
      eventId: crypto.randomUUID(),
      eventType: "order.fulfillment_changed",
      tenantId: input.tenantId,
      locationId: input.locationId,
      actorType: "POS_DEVICE",
      actorId: input.actorUserId,
      deviceId: input.deviceId,
      entityType: "order",
      entityId: input.orderId,
      updatedAt: readyAt,
      occurredAt: readyAt,
      payload: { status: "READY", source: "delivery_pos" },
    }));
    await client.query("COMMIT");
    return { status: "READY" as const, replayed: false, providerCommandId };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function handoffDeliveryOrder(input: {
  tenantId: string;
  locationId: string;
  orderId: string;
  actorUserId: string;
  deviceId: string;
  idempotencyKey: string;
  pickupCode?: string | null;
  riderReference?: string | null;
  bagCount: number;
  checklist: Record<string, unknown>;
}) {
  const key = input.idempotencyKey.trim();
  const pickupCode = input.pickupCode?.trim().slice(0, 80) || null;
  const riderReference = input.riderReference?.trim().slice(0, 120) || null;
  if (!validateKey(key) || !Number.isInteger(input.bagCount) || input.bagCount < 1 || input.bagCount > 100) {
    return { status: "INVALID_INPUT" as const };
  }
  const checklist = Object.fromEntries(HANDOFF_CHECKS.map((name) => [name, input.checklist[name] === true])) as Record<HandoffCheck, boolean>;
  if (HANDOFF_CHECKS.some((name) => !checklist[name])) return { status: "CHECKLIST_INCOMPLETE" as const };
  const requestHash = digest(JSON.stringify({ orderId: input.orderId, pickupCode, riderReference, bagCount: input.bagCount, checklist }));
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    if (!(await hasPermissionInTx(client, input.tenantId, input.actorUserId, "restaurant.delivery.handoff"))) {
      await client.query("ROLLBACK");
      return { status: "FORBIDDEN" as const };
    }
    const replay = await client.query<{
      id: string;
      request_hash: string;
      handed_over_at: unknown;
      provider: DeliveryProvider;
      transport_type: DeliveryTransportType | null;
    }>(
      `SELECT h.id, h.request_hash, h.handed_over_at, d.provider, d.transport_type
         FROM bms_delivery_handoffs h
         JOIN bms_delivery_orders d
           ON d.tenant_id = h.tenant_id AND d.id = h.delivery_order_id
        WHERE h.tenant_id = $1 AND h.idempotency_key = $2`,
      [input.tenantId, key],
    );
    if (replay.rows[0]) {
      if (replay.rows[0].provider === "FOODPANDA"
        && !foodpandaCommandForLocalTransition(replay.rows[0].transport_type, "HANDED_OVER").ok) {
        await client.query("ROLLBACK");
        return { status: "TRANSPORT_TYPE_REQUIRED" as const };
      }
      if (replay.rows[0].request_hash !== requestHash) {
        await client.query("ROLLBACK");
        return { status: "IDEMPOTENCY_CONFLICT" as const };
      }
      await client.query("COMMIT");
      return { status: "HANDED_OVER" as const, replayed: true, handoffId: replay.rows[0].id };
    }
    const row = await client.query<{
      id: string; bms_order_id: string; local_status: string; order_status: string;
      provider_status: string | null; provider: DeliveryProvider; integration_id: string;
      provider_order_id: string; provider_store_id: string; rollout_mode: string;
      outbound_commands_enabled: boolean; transport_type: DeliveryTransportType | null;
    }>(
      `SELECT d.id, d.bms_order_id, d.local_status, d.provider_status, d.provider,
              d.integration_id, d.provider_order_id, d.transport_type,
              lm.provider_store_id, i.rollout_mode, i.outbound_commands_enabled,
              o.status AS order_status
         FROM bms_delivery_orders d
         JOIN bms_orders o ON o.tenant_id = d.tenant_id AND o.id = d.bms_order_id
         JOIN bms_delivery_integrations i ON i.tenant_id = d.tenant_id AND i.id = d.integration_id
         JOIN bms_delivery_location_mappings lm
           ON lm.tenant_id = d.tenant_id AND lm.id = d.location_mapping_id
          AND lm.integration_id = d.integration_id AND lm.location_id = d.location_id
        WHERE d.tenant_id = $1 AND d.location_id = $2 AND d.bms_order_id = $3
        FOR UPDATE OF d, o`,
      [input.tenantId, input.locationId, input.orderId],
    );
    const order = row.rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      return { status: "NOT_FOUND" as const };
    }
    const foodpandaHandoff = order.provider === "FOODPANDA"
      ? foodpandaCommandForLocalTransition(order.transport_type, "HANDED_OVER") : null;
    if (foodpandaHandoff && !foodpandaHandoff.ok) {
      await client.query("ROLLBACK");
      return { status: "TRANSPORT_TYPE_REQUIRED" as const };
    }
    const prior = await client.query<{ id: string; request_hash: string }>(
      `SELECT id, request_hash FROM bms_delivery_handoffs
        WHERE tenant_id = $1 AND delivery_order_id = $2`,
      [input.tenantId, order.id],
    );
    if (prior.rows[0]) {
      await client.query("ROLLBACK");
      return { status: prior.rows[0].request_hash === requestHash ? "HANDED_OVER" as const : "ALREADY_HANDED_OVER" as const,
        replayed: prior.rows[0].request_hash === requestHash, handoffId: prior.rows[0].id };
    }
    if (order.local_status !== "READY" || order.order_status !== "PACKING") {
      await client.query("ROLLBACK");
      return { status: "INVALID_STATUS" as const, current: order.local_status };
    }
    const shipped = await shipOrderInTx(client, input.tenantId, order.bms_order_id, `user:${input.actorUserId}`);
    if (!shipped) throw new Error("DELIVERY_HANDOFF_STOCK_SETTLEMENT_FAILED");
    const providerCompleted = String(order.provider_status ?? "").toUpperCase() === "DELIVERED";
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO bms_delivery_handoffs (
         tenant_id, delivery_order_id, pickup_code_hash, pickup_code_display, bag_count,
         checklist, rider_reference, handed_over_by, device_id, idempotency_key, request_hash,
         provider_ack_status, provider_ack_at
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,
                 CASE WHEN $12 THEN 'CONFIRMED' ELSE 'PENDING' END,
                 CASE WHEN $12 THEN now() ELSE NULL END)
       RETURNING id`,
      [input.tenantId, order.id, pickupCode ? digest(pickupCode) : null, pickupCode?.slice(-4) ?? null,
        input.bagCount, JSON.stringify(checklist), riderReference, input.actorUserId, input.deviceId, key, requestHash,
        ["DISPATCHED", "DELIVERED"].includes(String(order.provider_status ?? "").toUpperCase())],
    );
    await client.query(
      `UPDATE bms_delivery_orders
          SET local_status = CASE WHEN $3 THEN 'COMPLETED' ELSE 'HANDED_OVER' END,
              handed_over_at = COALESCE(handed_over_at, now()),
              completed_at = CASE WHEN $3 THEN COALESCE(completed_at, now()) ELSE completed_at END,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [input.tenantId, order.id, providerCompleted],
    );
    if (providerCompleted) {
      await client.query(
        `UPDATE bms_orders SET status='COMPLETED',updated_at=now()
          WHERE tenant_id=$1 AND id=$2 AND status='SHIPPED'`,
        [input.tenantId, order.bms_order_id],
      );
    }
    await client.query(
      `INSERT INTO bms_delivery_order_events
         (tenant_id, delivery_order_id, event_kind, actor_type, actor_id, source, safe_detail)
       VALUES ($1,$2,'RIDER_HANDOFF','POS_DEVICE',$3,'POS',$4::jsonb)`,
      [input.tenantId, order.id, input.actorUserId, JSON.stringify({ bagCount: input.bagCount, checklist, deviceId: input.deviceId })],
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'restaurant.delivery_handoff',$3,$4::jsonb)`,
      [input.tenantId, input.actorUserId, order.id, JSON.stringify({ locationId: input.locationId, handoffId: inserted.rows[0].id, bagCount: input.bagCount })],
    );
    let providerCommandId: string | null = null;
    if (foodpandaHandoff?.ok && foodpandaHandoff.commandType === "MARK_DISPATCHED" && !providerCompleted) {
      const providerCommandReady = DELIVERY_CAPABILITIES[order.provider].markDispatched === "VERIFIED"
        && order.rollout_mode === "LIVE" && order.outbound_commands_enabled;
      const command = await enqueueDeliveryCommandInTx(client, {
        tenantId: input.tenantId,
        integrationId: order.integration_id,
        deliveryOrderId: order.id,
        commandType: "MARK_DISPATCHED",
        aggregateType: "delivery_handoff",
        aggregateId: inserted.rows[0].id,
        desiredState: { providerOrderId: order.provider_order_id, providerStoreId: order.provider_store_id },
        idempotencyKey: commandKey("dispatched", key),
        initialStatus: providerCommandReady ? "PENDING" : "MANUAL_ACTION_REQUIRED",
      });
      providerCommandId = command.id;
    }
    await client.query("COMMIT");
    return { status: "HANDED_OVER" as const, replayed: false, handoffId: inserted.rows[0].id, providerCommandId };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
