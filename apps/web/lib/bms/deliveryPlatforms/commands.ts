import { createHash } from "crypto";
import type { PoolClient } from "pg";

import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "../tenant";
import { decryptSecret } from "../crypto";
import { enqueueRealtimeEventInTx, realtimeEvent } from "../realtimeOutbox";
import { getDeliveryPlatformAdapter } from ".";
import type { AdapterResult, DeliveryAdapterConfig, DeliveryProvider } from "./types";

export const DELIVERY_COMMAND_TYPES = [
  "ACCEPT_ORDER", "REJECT_ORDER", "MARK_READY", "CANCEL_ORDER",
  "PAUSE_STORE", "RESUME_STORE", "SET_ITEM_AVAILABILITY",
] as const;
export type DeliveryCommandType = (typeof DELIVERY_COMMAND_TYPES)[number];

type ClaimedCommand = {
  id: string;
  tenant_id: string;
  integration_id: string;
  delivery_order_id: string | null;
  command_type: DeliveryCommandType;
  desired_state: Record<string, unknown>;
  idempotency_key: string;
  attempts: number;
  claim_token: string;
};

export function stableDeliveryCommandHash(commandType: DeliveryCommandType, desiredState: Record<string, unknown>) {
  return createHash("sha256")
    .update(JSON.stringify({ commandType, desiredState }))
    .digest("hex");
}

export async function enqueueDeliveryCommandInTx(
  client: PoolClient,
  input: {
    tenantId: string;
    integrationId: string;
    deliveryOrderId?: string | null;
    commandType: DeliveryCommandType;
    aggregateType: string;
    aggregateId: string;
    desiredState: Record<string, unknown>;
    idempotencyKey: string;
    initialStatus?: "PENDING" | "MANUAL_ACTION_REQUIRED";
  },
): Promise<{ id: string; replayed: boolean }> {
  const requestHash = stableDeliveryCommandHash(input.commandType, input.desiredState);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO bms_delivery_commands (
       tenant_id, integration_id, delivery_order_id, command_type, aggregate_type,
       aggregate_id, desired_state, idempotency_key, request_hash, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
     ON CONFLICT (tenant_id, integration_id, idempotency_key) DO NOTHING
     RETURNING id`,
    [
      input.tenantId, input.integrationId, input.deliveryOrderId ?? null, input.commandType,
      input.aggregateType, input.aggregateId, JSON.stringify(input.desiredState),
      input.idempotencyKey, requestHash, input.initialStatus ?? "PENDING",
    ],
  );
  if (inserted.rows[0]) return { id: inserted.rows[0].id, replayed: false };
  const replay = await client.query<{ id: string; request_hash: string }>(
    `SELECT id, request_hash FROM bms_delivery_commands
      WHERE tenant_id = $1 AND integration_id = $2 AND idempotency_key = $3`,
    [input.tenantId, input.integrationId, input.idempotencyKey],
  );
  if (!replay.rows[0] || replay.rows[0].request_hash !== requestHash) {
    throw new Error("DELIVERY_COMMAND_IDEMPOTENCY_CONFLICT");
  }
  return { id: replay.rows[0].id, replayed: true };
}

async function loadConfig(command: ClaimedCommand): Promise<{
  provider: DeliveryProvider;
  config: DeliveryAdapterConfig;
  outboundEnabled: boolean;
} | null> {
  const client = await getClient();
  try {
    await beginTenantTx(client, command.tenant_id);
    const result = await client.query<any>(
      `SELECT provider, environment, active, rollout_mode, outbound_commands_enabled,
              client_id, client_secret_encrypted, access_token_encrypted,
              refresh_token_encrypted, webhook_secret_encrypted, api_version, config
         FROM bms_delivery_integrations
        WHERE tenant_id = $1 AND id = $2`,
      [command.tenant_id, command.integration_id],
    );
    await client.query("COMMIT");
    const row = result.rows[0];
    if (!row) return null;
    return {
      provider: row.provider,
      outboundEnabled: row.active && row.rollout_mode === "LIVE" && row.outbound_commands_enabled,
      config: {
        environment: row.environment,
        clientId: row.client_id,
        clientSecret: decryptSecret(row.client_secret_encrypted),
        accessToken: decryptSecret(row.access_token_encrypted),
        refreshToken: decryptSecret(row.refresh_token_encrypted),
        webhookSecret: decryptSecret(row.webhook_secret_encrypted),
        apiVersion: row.api_version,
        config: row.config ?? {},
      },
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

function stringField(state: Record<string, unknown>, name: string): string | null {
  const value = state[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function executeCommand(command: ClaimedCommand): Promise<AdapterResult<{ status: string }>> {
  const loaded = await loadConfig(command);
  if (!loaded || !loaded.outboundEnabled) {
    return { ok: false, code: "UNCONFIGURED", retryable: false, detail: "Outbound delivery commands are disabled" };
  }
  const adapter = getDeliveryPlatformAdapter(loaded.provider);
  const providerOrderId = stringField(command.desired_state, "providerOrderId");
  const providerStoreId = stringField(command.desired_state, "providerStoreId");
  const base = providerOrderId && providerStoreId
    ? { providerOrderId, providerStoreId, idempotencyKey: command.idempotency_key }
    : null;
  switch (command.command_type) {
    case "ACCEPT_ORDER":
      return base ? adapter.acceptOrder(loaded.config, base) : {
        ok: false, code: "INVALID_RESPONSE", retryable: false, detail: "Command order identity is missing",
      };
    case "REJECT_ORDER": {
      const reasonCode = stringField(command.desired_state, "reasonCode");
      return base && reasonCode ? adapter.rejectOrder(loaded.config, { ...base, reasonCode }) : {
        ok: false, code: "INVALID_RESPONSE", retryable: false, detail: "Command rejection identity/reason is missing",
      };
    }
    case "MARK_READY":
      return base ? adapter.markReady(loaded.config, base) : {
        ok: false, code: "INVALID_RESPONSE", retryable: false, detail: "Command order identity is missing",
      };
    case "CANCEL_ORDER": {
      const reasonCode = stringField(command.desired_state, "reasonCode");
      return base && reasonCode ? adapter.cancelOrder(loaded.config, { ...base, reasonCode }) : {
        ok: false, code: "INVALID_RESPONSE", retryable: false, detail: "Command cancellation identity/reason is missing",
      };
    }
    case "PAUSE_STORE":
    case "RESUME_STORE":
      return providerStoreId ? adapter.pauseStore(loaded.config, {
        providerStoreId,
        paused: command.command_type === "PAUSE_STORE",
        pausedUntil: stringField(command.desired_state, "pausedUntil"),
        idempotencyKey: command.idempotency_key,
      }) : { ok: false, code: "INVALID_RESPONSE", retryable: false, detail: "Command store identity is missing" };
    case "SET_ITEM_AVAILABILITY": {
      const providerItemId = stringField(command.desired_state, "providerItemId");
      const available = command.desired_state.available;
      return providerStoreId && providerItemId && typeof available === "boolean"
        ? adapter.setItemAvailability(loaded.config, {
            providerStoreId, providerItemId, available, idempotencyKey: command.idempotency_key,
          })
        : { ok: false, code: "INVALID_RESPONSE", retryable: false, detail: "Availability command is incomplete" };
    }
  }
}

async function finishCommand(command: ClaimedCommand, result: AdapterResult<{ status: string }>) {
  const client = await getClient();
  try {
    await beginTenantTx(client, command.tenant_id);
    let finalized;
    if (result.ok) {
      finalized = await client.query(
        `UPDATE bms_delivery_commands
            SET status = 'SUCCEEDED', completed_at = now(), provider_response_ref = $4,
                claimed_at = NULL, claim_token = NULL, last_error = NULL, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND claim_token = $3 AND status = 'PROCESSING'`,
        [command.tenant_id, command.id, command.claim_token, result.providerReference ?? result.value.status],
      );
    } else {
      const retry = result.retryable && command.attempts < 10;
      const manual = result.code === "CONTRACT_BLOCKED" || result.code === "UNSUPPORTED";
      const nextStatus = retry ? "RETRY" : manual ? "MANUAL_ACTION_REQUIRED" : "FAILED";
      const delaySeconds = Math.min(900, 5 * 2 ** Math.min(command.attempts, 8));
      finalized = await client.query(
        `UPDATE bms_delivery_commands
            SET status = $4,
                next_retry_at = CASE WHEN $4 = 'RETRY' THEN now() + ($5 * interval '1 second') ELSE next_retry_at END,
                claimed_at = NULL, claim_token = NULL, last_error = $6, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND claim_token = $3 AND status = 'PROCESSING'`,
        [command.tenant_id, command.id, command.claim_token, nextStatus, delaySeconds, result.detail.slice(0, 500)],
      );
    }
    if ((finalized.rowCount ?? 0) !== 1) throw new Error("DELIVERY_COMMAND_CLAIM_LOST");
    const commandTerminalProblem = !result.ok && !(result.retryable && command.attempts < 10);
    if (commandTerminalProblem && command.delivery_order_id) {
      const relatedOrder = await client.query<{ bms_order_id: string | null; location_id: string }>(
        `SELECT bms_order_id, location_id FROM bms_delivery_orders
          WHERE tenant_id = $1 AND id = $2`,
        [command.tenant_id, command.delivery_order_id],
      );
      if (relatedOrder.rows[0]?.bms_order_id) {
        const failedAt = new Date().toISOString();
        await enqueueRealtimeEventInTx(client, realtimeEvent({
          eventId: crypto.randomUUID(),
          eventType: "order.fulfillment_changed",
          tenantId: command.tenant_id,
          locationId: relatedOrder.rows[0].location_id,
          actorType: "JOB",
          entityType: "order",
          entityId: relatedOrder.rows[0].bms_order_id,
          updatedAt: failedAt,
          occurredAt: failedAt,
          payload: { status: "ACTION_REQUIRED", source: "delivery_command" },
        }));
      }
    }
    if (command.desired_state.controlVersion !== undefined) {
      const controlVersion = Number(command.desired_state.controlVersion);
      if (Number.isSafeInteger(controlVersion) && controlVersion > 0) {
        // The relationship comes from the durable command row, never provider data.
        const commandAggregate = await client.query<{ aggregate_id: string }>(
          `SELECT aggregate_id FROM bms_delivery_commands
            WHERE tenant_id = $1 AND id = $2`,
          [command.tenant_id, command.id],
        );
        const aggregateId = commandAggregate.rows[0]?.aggregate_id;
        if (aggregateId) {
          const counts = await client.query<{
            total: string; succeeded: string; pending: string; failed: string; manual: string;
          }>(
            `SELECT COUNT(*)::text AS total,
                    COUNT(*) FILTER (WHERE status = 'SUCCEEDED')::text AS succeeded,
                    COUNT(*) FILTER (WHERE status IN ('PENDING','PROCESSING','RETRY'))::text AS pending,
                    COUNT(*) FILTER (WHERE status = 'FAILED')::text AS failed,
                    COUNT(*) FILTER (WHERE status = 'MANUAL_ACTION_REQUIRED')::text AS manual
               FROM bms_delivery_commands
              WHERE tenant_id = $1 AND aggregate_type = 'delivery_intake_control'
                AND aggregate_id = $2
                AND desired_state->>'controlVersion' = $3`,
            [command.tenant_id, aggregateId, String(controlVersion)],
          );
          const count = counts.rows[0];
          const total = Number(count?.total ?? 0);
          const pending = Number(count?.pending ?? 0);
          const failed = Number(count?.failed ?? 0);
          const manual = Number(count?.manual ?? 0);
          const succeeded = Number(count?.succeeded ?? 0);
          const syncStatus = pending > 0 ? "PENDING"
            : manual > 0 ? "MANUAL_PROVIDER_ACTION_REQUIRED"
            : failed > 0 ? "FAILED"
            : total > 0 && succeeded === total ? "SYNCED" : "LOCAL_ONLY";
          await client.query(
            `UPDATE bms_delivery_intake_controls
                SET sync_status = CASE WHEN sync_status = 'MANUAL_PROVIDER_ACTION_REQUIRED'
                                       THEN sync_status ELSE $4 END,
                    provider_state = CASE WHEN $4 = 'SYNCED'
                                           AND sync_status <> 'MANUAL_PROVIDER_ACTION_REQUIRED'
                                          THEN desired_state ELSE provider_state END,
                    last_synced_at = CASE WHEN $4 = 'SYNCED'
                                           AND sync_status <> 'MANUAL_PROVIDER_ACTION_REQUIRED'
                                          THEN now() ELSE last_synced_at END,
                    last_error = CASE WHEN sync_status = 'MANUAL_PROVIDER_ACTION_REQUIRED'
                                      THEN last_error
                                      WHEN $4 IN ('FAILED','MANUAL_PROVIDER_ACTION_REQUIRED') THEN $5
                                      ELSE NULL END,
                    updated_at = now()
              WHERE tenant_id = $1 AND id = $2 AND version = $3`,
            [command.tenant_id, aggregateId, controlVersion, syncStatus, result.ok ? null : result.detail.slice(0, 500)],
          );
        }
      }
    }
    await client.query("COMMIT");
    return result.ok ? "SUCCEEDED" as const
      : result.retryable && command.attempts < 10 ? "RETRY" as const
      : result.code === "CONTRACT_BLOCKED" || result.code === "UNSUPPORTED"
        ? "MANUAL_ACTION_REQUIRED" as const : "FAILED" as const;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function runDeliveryCommandBatch(limit = 25) {
  const bounded = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const claimed = await query<ClaimedCommand>(
    `SELECT * FROM public.bms_claim_delivery_commands($1, $2)`,
    [bounded, 60_000],
  );
  const summary = { claimed: claimed.rows.length, succeeded: 0, retried: 0, failed: 0, manualActionRequired: 0 };
  for (const command of claimed.rows) {
    let result: AdapterResult<{ status: string }>;
    try {
      result = await executeCommand(command);
    } catch (error) {
      result = {
        ok: false,
        code: "PROVIDER_ERROR",
        retryable: true,
        detail: error instanceof Error ? error.message : "Delivery command failed",
      };
    }
    const outcome = await finishCommand(command, result);
    if (outcome === "SUCCEEDED") summary.succeeded += 1;
    else if (outcome === "RETRY") summary.retried += 1;
    else if (outcome === "MANUAL_ACTION_REQUIRED") summary.manualActionRequired += 1;
    else summary.failed += 1;
  }
  return summary;
}
