import { createHash } from "crypto";

import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "../tenant";
import { restaurantOrderingStateInTx } from "../restaurantOrdering";
import { DELIVERY_CAPABILITIES } from "./capabilities";
import { enqueueDeliveryCommandInTx } from "./commands";
import type { DeliveryProvider } from "./types";

type IntakeRow = {
  id: string;
  location_id: string | null;
  integration_id: string | null;
  scope: string;
  desired_state: string;
  provider_state: string;
  sync_status: string;
  reason: string | null;
  paused_until: Date | string | null;
  version: string | number;
  last_error: string | null;
};

function hashRequest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function listDeliveryIntakeControls(tenantId: string, locationId: string) {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const result = await client.query<IntakeRow>(
    `SELECT id, location_id, integration_id, scope, desired_state, provider_state,
            sync_status, reason, paused_until, version, last_error
       FROM bms_delivery_intake_controls
      WHERE tenant_id = $1
        AND (location_id IS NULL OR location_id = $2)
      ORDER BY CASE scope WHEN 'ALL_ONLINE' THEN 1 WHEN 'DELIVERY_PLATFORMS' THEN 2
               WHEN 'BRANCH' THEN 3 ELSE 4 END`,
    [tenantId, locationId],
  );
    await client.query("COMMIT");
    return result.rows.map((row) => ({
    id: row.id,
    locationId: row.location_id,
    integrationId: row.integration_id,
    scope: row.scope,
    desiredState: row.desired_state,
    providerState: row.provider_state,
    syncStatus: row.sync_status,
    reason: row.reason,
    pausedUntil: row.paused_until ? new Date(row.paused_until).toISOString() : null,
    version: Number(row.version),
    lastError: row.last_error,
    }));
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function setDeliveryIntakeForBranch(input: {
  tenantId: string;
  locationId: string;
  integrationId?: string | null;
  paused: boolean;
  pausedUntil?: string | null;
  reason: string;
  actorUserId: string;
  deviceId: string;
  idempotencyKey: string;
}) {
  const reason = input.reason.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  const pausedUntil = input.pausedUntil ? new Date(input.pausedUntil) : null;
  if (!reason || reason.length > 240) return { status: "INVALID_REASON" as const };
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) return { status: "INVALID_IDEMPOTENCY_KEY" as const };
  if (pausedUntil && Number.isNaN(pausedUntil.getTime())) return { status: "INVALID_PAUSE_TIME" as const };
  if (input.paused && pausedUntil && pausedUntil.getTime() <= Date.now()) return { status: "INVALID_PAUSE_TIME" as const };
  const scope = input.integrationId ? "PROVIDER" : "BRANCH";
  const requestHash = hashRequest({
    scope,
    locationId: input.locationId,
    integrationId: input.integrationId ?? null,
    paused: input.paused,
    pausedUntil: pausedUntil?.toISOString() ?? null,
    reason,
  });

  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const integrations = await client.query<{
      id: string; provider: DeliveryProvider; provider_store_id: string;
      rollout_mode: string; outbound_commands_enabled: boolean;
    }>(
      `SELECT i.id, i.provider, i.rollout_mode, i.outbound_commands_enabled, lm.provider_store_id
         FROM bms_delivery_integrations i
         JOIN bms_delivery_location_mappings lm
           ON lm.tenant_id = i.tenant_id AND lm.integration_id = i.id
        WHERE i.tenant_id = $1 AND lm.location_id = $2 AND lm.active AND i.active
          AND ($3::uuid IS NULL OR i.id = $3)`,
      [input.tenantId, input.locationId, input.integrationId ?? null],
    );
    if (input.integrationId && !integrations.rows[0]) {
      await client.query("ROLLBACK");
      return { status: "INTEGRATION_NOT_FOUND" as const };
    }

    const existing = await client.query<{
      id: string; last_idempotency_key: string | null; last_request_hash: string | null; version: string;
    }>(
      `SELECT id, last_idempotency_key, last_request_hash, version
         FROM bms_delivery_intake_controls
        WHERE tenant_id = $1 AND scope = $2 AND location_id = $3
          AND integration_id IS NOT DISTINCT FROM $4
        FOR UPDATE`,
      [input.tenantId, scope, input.locationId, input.integrationId ?? null],
    );
    if (existing.rows[0]?.last_idempotency_key === idempotencyKey) {
      if (existing.rows[0].last_request_hash !== requestHash) {
        await client.query("ROLLBACK");
        return { status: "IDEMPOTENCY_CONFLICT" as const };
      }
      await client.query("COMMIT");
      return { status: "UPDATED" as const, replayed: true, version: Number(existing.rows[0].version) };
    }

    const canCommand = (row: typeof integrations.rows[number]) =>
      DELIVERY_CAPABILITIES[row.provider].pauseStore === "VERIFIED"
      && row.rollout_mode === "LIVE" && row.outbound_commands_enabled;
    const anyManual = integrations.rows.some((row) => !canCommand(row));
    const anyCommand = integrations.rows.some(canCommand);
    const saved = await client.query<{ id: string; version: string }>(
      `INSERT INTO bms_delivery_intake_controls (
         tenant_id, location_id, integration_id, scope, desired_state, provider_state,
         sync_status, reason, paused_until, version, changed_by, device_id,
         last_idempotency_key, last_request_hash
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11,$12,$13)
       ON CONFLICT (
         tenant_id, scope,
         (COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid)),
         (COALESCE(integration_id, '00000000-0000-0000-0000-000000000000'::uuid))
       ) DO UPDATE SET
         desired_state = EXCLUDED.desired_state,
         provider_state = EXCLUDED.provider_state,
         sync_status = EXCLUDED.sync_status,
         reason = EXCLUDED.reason,
         paused_until = EXCLUDED.paused_until,
         version = bms_delivery_intake_controls.version + 1,
         changed_by = EXCLUDED.changed_by,
         device_id = EXCLUDED.device_id,
         last_idempotency_key = EXCLUDED.last_idempotency_key,
         last_request_hash = EXCLUDED.last_request_hash,
         last_error = NULL,
         updated_at = now()
       RETURNING id, version`,
      [
        input.tenantId, input.locationId, input.integrationId ?? null, scope,
        input.paused ? "PAUSED" : "ACCEPTING",
        anyManual ? "UNSUPPORTED" : "UNKNOWN",
        anyManual ? "MANUAL_PROVIDER_ACTION_REQUIRED" : anyCommand ? "PENDING" : "LOCAL_ONLY",
        reason, pausedUntil, input.actorUserId, input.deviceId, idempotencyKey, requestHash,
      ],
    );

    for (const integration of integrations.rows) {
      if (!canCommand(integration)) continue;
      await enqueueDeliveryCommandInTx(client, {
        tenantId: input.tenantId,
        integrationId: integration.id,
        commandType: input.paused ? "PAUSE_STORE" : "RESUME_STORE",
        aggregateType: "delivery_intake_control",
        aggregateId: saved.rows[0].id,
        desiredState: {
          providerStoreId: integration.provider_store_id,
          pausedUntil: pausedUntil?.toISOString() ?? null,
          controlVersion: Number(saved.rows[0].version),
        },
        idempotencyKey: `${input.paused ? "pause" : "resume"}:${idempotencyKey}:${integration.id}`,
      });
    }
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'restaurant.delivery_intake_change',$3,$4::jsonb)`,
      [
        input.tenantId, input.actorUserId, saved.rows[0].id,
        JSON.stringify({ scope, locationId: input.locationId, integrationId: input.integrationId ?? null,
          paused: input.paused, pausedUntil: pausedUntil?.toISOString() ?? null, reason }),
      ],
    );
    await client.query("COMMIT");
    return {
      status: "UPDATED" as const,
      replayed: false,
      version: Number(saved.rows[0].version),
      syncStatus: anyManual ? "MANUAL_PROVIDER_ACTION_REQUIRED" : anyCommand ? "PENDING" : "LOCAL_ONLY",
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function runDeliveryAutoResumeBatch(limit = 25) {
  const due = await query<{ tenant_id: string; id: string; version: string }>(
    `SELECT * FROM public.bms_due_delivery_intake_controls($1)`,
    [Math.min(Math.max(Math.trunc(limit), 1), 100)],
  );
  const summary = { due: due.rows.length, resumed: 0, skipped: 0, manualActionRequired: 0 };
  for (const candidate of due.rows) {
    const client = await getClient();
    try {
      await beginTenantTx(client, candidate.tenant_id);
      const control = await client.query<{
        id: string; location_id: string | null; integration_id: string | null;
        desired_state: string; paused_until: Date | string | null; version: string;
      }>(
        `SELECT id, location_id, integration_id, desired_state, paused_until, version
           FROM bms_delivery_intake_controls
          WHERE tenant_id = $1 AND id = $2
          FOR UPDATE`,
        [candidate.tenant_id, candidate.id],
      );
      const row = control.rows[0];
      if (!row || row.desired_state !== "PAUSED" || Number(row.version) !== Number(candidate.version)
        || !row.paused_until || new Date(row.paused_until).getTime() > Date.now()) {
        await client.query("ROLLBACK");
        summary.skipped += 1;
        continue;
      }
      const ordering = await restaurantOrderingStateInTx(client, candidate.tenant_id);
      if (!ordering.isRestaurant || !ordering.accepting || !row.location_id) {
        await client.query("ROLLBACK");
        summary.skipped += 1;
        continue;
      }
      const integrations = await client.query<{
        id: string; provider: DeliveryProvider; provider_store_id: string;
        health_status: string; credential_expires_at: Date | string | null;
        outbound_commands_enabled: boolean;
      }>(
        `SELECT i.id, i.provider, lm.provider_store_id, i.health_status, i.credential_expires_at,
                i.outbound_commands_enabled
           FROM bms_delivery_integrations i
           JOIN bms_delivery_location_mappings lm
             ON lm.tenant_id = i.tenant_id AND lm.integration_id = i.id
          WHERE i.tenant_id = $1 AND lm.location_id = $2 AND lm.active AND i.active
            AND i.rollout_mode = 'LIVE'
            AND ($3::uuid IS NULL OR i.id = $3)
          FOR SHARE OF i, lm`,
        [candidate.tenant_id, row.location_id, row.integration_id],
      );
      if (!integrations.rows.length || integrations.rows.some((integration) =>
        !["HEALTHY", "DEGRADED"].includes(integration.health_status)
        || (integration.credential_expires_at && new Date(integration.credential_expires_at).getTime() <= Date.now())
      )) {
        await client.query("ROLLBACK");
        summary.skipped += 1;
        continue;
      }
      const newVersion = Number(row.version) + 1;
      const canCommand = (integration: typeof integrations.rows[number]) =>
        DELIVERY_CAPABILITIES[integration.provider].pauseStore === "VERIFIED"
        && integration.outbound_commands_enabled;
      const anyManual = integrations.rows.some((integration) => !canCommand(integration));
      const anyCommand = integrations.rows.some(canCommand);
      const updated = await client.query(
        `UPDATE bms_delivery_intake_controls
            SET desired_state = 'ACCEPTING', paused_until = NULL,
                provider_state = CASE WHEN $4 THEN 'UNSUPPORTED' ELSE 'UNKNOWN' END,
                sync_status = CASE WHEN $4 THEN 'MANUAL_PROVIDER_ACTION_REQUIRED'
                                   WHEN $8 THEN 'PENDING' ELSE 'LOCAL_ONLY' END,
                version = $3, changed_by = NULL, device_id = NULL,
                last_idempotency_key = $5, last_request_hash = $6, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND version = $7 AND desired_state = 'PAUSED'`,
        [
          candidate.tenant_id, row.id, newVersion, anyManual,
          `auto-resume:${row.id}:${row.version}`,
          hashRequest({ autoResume: true, controlId: row.id, fromVersion: Number(row.version) }),
          row.version, anyCommand,
        ],
      );
      if ((updated.rowCount ?? 0) !== 1) {
        await client.query("ROLLBACK");
        summary.skipped += 1;
        continue;
      }
      for (const integration of integrations.rows) {
        if (!canCommand(integration)) continue;
        await enqueueDeliveryCommandInTx(client, {
          tenantId: candidate.tenant_id,
          integrationId: integration.id,
          commandType: "RESUME_STORE",
          aggregateType: "delivery_intake_control",
          aggregateId: row.id,
          desiredState: {
            providerStoreId: integration.provider_store_id,
            controlVersion: newVersion,
          },
          idempotencyKey: `auto-resume:${row.id}:${row.version}:${integration.id}`,
        });
      }
      await client.query(
        `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
         VALUES ($1,'system:delivery-auto-resume','restaurant.delivery_intake_auto_resume',$2,$3::jsonb)`,
        [candidate.tenant_id, row.id, JSON.stringify({ fromVersion: Number(row.version), toVersion: newVersion })],
      );
      await client.query("COMMIT");
      summary.resumed += 1;
      if (anyManual) summary.manualActionRequired += 1;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }
  return summary;
}
