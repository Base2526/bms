import type { PoolClient } from "pg";

import { getClient, query } from "@/lib/db";
import { decryptSecret } from "../crypto";
import { beginTenantTx } from "../tenant";
import { getDeliveryPlatformAdapter } from ".";
import type { DeliveryAdapterConfig, DeliveryProvider, VerifiedDeliveryWebhook } from "./types";

type IntegrationRow = {
  id: string;
  tenant_id: string;
  provider: DeliveryProvider;
  environment: "SANDBOX" | "LIVE";
  active: boolean;
  rollout_mode: "OFF" | "SHADOW" | "LIVE";
  webhook_secret_encrypted: string | null;
  api_version: string | null;
  config: Record<string, unknown> | null;
};

export type DeliveryWebhookIntakeResult =
  | { status: "ACCEPTED"; eventId: string; duplicate: false }
  | { status: "DUPLICATE"; eventId: string; duplicate: true }
  | { status: "NOT_FOUND" | "DISABLED" | "PROVIDER_MISMATCH" }
  | { status: "INVALID" | "UNAUTHORIZED" | "CONTRACT_BLOCKED"; detail: string }
  | { status: "CONFLICT"; detail: string };

function adapterConfig(row: IntegrationRow): DeliveryAdapterConfig {
  return {
    integrationId: row.id,
    environment: row.environment,
    clientId: null,
    clientSecret: null,
    accessToken: null,
    refreshToken: null,
    webhookSecret: decryptSecret(row.webhook_secret_encrypted),
    apiVersion: row.api_version,
    config: row.config ?? {},
  };
}

async function findIntegration(integrationId: string): Promise<IntegrationRow | null> {
  // This lookup derives tenant authority from the opaque integration id. It is
  // intentionally the only pre-tenant query; all writes below use beginTenantTx
  // and re-lock the same integration under RLS before accepting the event.
  const result = await query<IntegrationRow>(
    `SELECT id, tenant_id, provider, environment, active, rollout_mode,
            webhook_secret_encrypted, api_version, config
       FROM public.bms_resolve_delivery_webhook_integration($1)`,
    [integrationId],
  );
  return result.rows[0] ?? null;
}

async function storeVerifiedEvent(
  client: PoolClient,
  integration: IntegrationRow,
  event: VerifiedDeliveryWebhook,
): Promise<DeliveryWebhookIntakeResult> {
  const locked = await client.query<{ active: boolean; rollout_mode: string; provider: string }>(
    `SELECT active, rollout_mode, provider
       FROM bms_delivery_integrations
      WHERE tenant_id = $1 AND id = $2
      FOR UPDATE`,
    [integration.tenant_id, integration.id],
  );
  const row = locked.rows[0];
  if (!row || !row.active || row.rollout_mode === "OFF") return { status: "DISABLED" };

  const mapping = await client.query<{ location_id: string }>(
    `SELECT location_id
       FROM bms_delivery_location_mappings
      WHERE tenant_id = $1 AND integration_id = $2
        AND provider_store_id = $3 AND active
      LIMIT 1`,
    [integration.tenant_id, integration.id, event.providerStoreId],
  );
  // An unmapped store is still durable evidence and an Action Center task. It
  // must never become an order or borrow a branch from the request.
  const processingStatus = mapping.rows[0] ? "PENDING" : "ACTION_REQUIRED";
  const errorCode = mapping.rows[0] ? null : "UNMAPPED_STORE";
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO bms_delivery_events (
       tenant_id, integration_id, external_event_id, event_type,
       provider_version, provider_occurred_at, payload_hash, sanitized_payload,
       processing_status, error_code
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
     ON CONFLICT (tenant_id, integration_id, external_event_id) DO NOTHING
     RETURNING id`,
    [
      integration.tenant_id,
      integration.id,
      event.externalEventId,
      event.eventType,
      event.providerVersion,
      event.providerOccurredAt,
      event.payloadHash,
      JSON.stringify(event.sanitizedPayload),
      processingStatus,
      errorCode,
    ],
  );
  if (!inserted.rows[0]) {
    const existing = await client.query<{ id: string; payload_hash: string }>(
      `SELECT id, payload_hash FROM bms_delivery_events
        WHERE tenant_id = $1 AND integration_id = $2 AND external_event_id = $3
        FOR UPDATE`,
      [integration.tenant_id, integration.id, event.externalEventId],
    );
    if (!existing.rows[0] || existing.rows[0].payload_hash !== event.payloadHash) {
      if (existing.rows[0]) {
        await client.query(
          `UPDATE bms_delivery_events
              SET processing_status = 'ACTION_REQUIRED', error_code = 'WEBHOOK_PAYLOAD_CONFLICT',
                  last_error = 'Provider reused a logical event id for a different payload',
                  claimed_at = NULL, claim_token = NULL, processed_at = NULL, updated_at = now()
            WHERE tenant_id = $1 AND id = $2`,
          [integration.tenant_id, existing.rows[0].id],
        );
      }
      return { status: "CONFLICT", detail: "Provider reused an event id for a different payload" };
    }
    await client.query(
      `UPDATE bms_delivery_integrations
          SET last_webhook_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [integration.tenant_id, integration.id],
    );
    return { status: "DUPLICATE", eventId: existing.rows[0].id, duplicate: true };
  }

  await client.query(
    `UPDATE bms_delivery_integrations
        SET last_webhook_at = now(), last_error = NULL,
            health_status = CASE WHEN health_status IN ('WEBHOOK_FAILED','UNCONFIGURED') THEN 'HEALTHY' ELSE health_status END,
            updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [integration.tenant_id, integration.id],
  );
  return { status: "ACCEPTED", eventId: inserted.rows[0].id, duplicate: false };
}

export async function intakeDeliveryWebhook(input: {
  integrationId: string;
  provider: DeliveryProvider;
  rawBody: string;
  headers: Headers;
}): Promise<DeliveryWebhookIntakeResult> {
  const integration = await findIntegration(input.integrationId);
  if (!integration) return { status: "NOT_FOUND" };
  if (integration.provider !== input.provider) return { status: "PROVIDER_MISMATCH" };
  if (!integration.active || integration.rollout_mode === "OFF") return { status: "DISABLED" };

  const adapter = getDeliveryPlatformAdapter(integration.provider);
  const verified = adapter.verifyWebhook({
    rawBody: input.rawBody,
    headers: input.headers,
    config: adapterConfig(integration),
  });
  if (!verified.ok) {
    if (verified.code === "AUTH_FAILED") return { status: "UNAUTHORIZED", detail: verified.detail };
    if (verified.code === "CONTRACT_BLOCKED") return { status: "CONTRACT_BLOCKED", detail: verified.detail };
    return { status: "INVALID", detail: verified.detail };
  }

  const client = await getClient();
  try {
    await beginTenantTx(client, integration.tenant_id);
    const result = await storeVerifiedEvent(client, integration, verified.value);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
