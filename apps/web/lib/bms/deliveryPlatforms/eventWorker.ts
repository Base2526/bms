import type { PoolClient } from "pg";

import { getClient, query } from "@/lib/db";
import { createOrderInTx, type OrderItemInput } from "../orders";
import { beginTenantTx } from "../tenant";
import { decryptSecret } from "../crypto";
import { enqueueRealtimeEventInTx, realtimeEvent } from "../realtimeOutbox";
import { getDeliveryPlatformAdapter } from ".";
import type {
  DeliveryAdapterConfig,
  DeliveryProvider,
  NormalizedProviderOrder,
  NormalizedProviderOrderLine,
} from "./types";

type ClaimedEvent = {
  id: string;
  tenant_id: string;
  integration_id: string;
  external_event_id: string;
  event_type: string;
  provider_version: string | null;
  provider_occurred_at: Date | string | null;
  sanitized_payload: Record<string, unknown>;
  attempts: number;
  claim_token: string;
};

type IntegrationContext = {
  tenantId: string;
  integrationId: string;
  provider: DeliveryProvider;
  environment: "SANDBOX" | "LIVE";
  active: boolean;
  rolloutMode: "OFF" | "SHADOW" | "LIVE";
  clientId: string | null;
  clientSecret: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  webhookSecret: string | null;
  apiVersion: string | null;
  configVersion: number;
  config: Record<string, unknown>;
};

type Mapping = {
  line: NormalizedProviderOrderLine;
  sku: string;
  size: string;
  modifierCodes: string[];
  modifierMappings: Array<{ providerModifierId: string; modifierCode: string }>;
};

class DeliveryActionRequiredError extends Error {
  constructor(readonly code: string, detail: string) {
    super(detail);
    this.name = "DeliveryActionRequiredError";
  }
}

export type DeliveryEventBatchResult = {
  claimed: number;
  processed: number;
  actionRequired: number;
  retried: number;
  deadLettered: number;
};

function configOf(context: IntegrationContext): DeliveryAdapterConfig {
  return {
    integrationId: context.integrationId,
    environment: context.environment,
    clientId: context.clientId,
    clientSecret: context.clientSecret,
    accessToken: context.accessToken,
    refreshToken: context.refreshToken,
    webhookSecret: context.webhookSecret,
    apiVersion: context.apiVersion,
    config: context.config,
  };
}

async function loadIntegrationContext(event: ClaimedEvent): Promise<IntegrationContext | null> {
  const client = await getClient();
  try {
    await beginTenantTx(client, event.tenant_id);
    const result = await client.query<any>(
      `SELECT provider, environment, active, rollout_mode, client_id,
              client_secret_encrypted, access_token_encrypted, refresh_token_encrypted,
              webhook_secret_encrypted, api_version, config_version, config
         FROM bms_delivery_integrations
        WHERE tenant_id = $1 AND id = $2`,
      [event.tenant_id, event.integration_id],
    );
    await client.query("COMMIT");
    const row = result.rows[0];
    if (!row) return null;
    return {
      tenantId: event.tenant_id,
      integrationId: event.integration_id,
      provider: row.provider,
      environment: row.environment,
      active: row.active,
      rolloutMode: row.rollout_mode,
      clientId: row.client_id,
      clientSecret: decryptSecret(row.client_secret_encrypted),
      accessToken: decryptSecret(row.access_token_encrypted),
      refreshToken: decryptSecret(row.refresh_token_encrypted),
      webhookSecret: decryptSecret(row.webhook_secret_encrypted),
      apiVersion: row.api_version,
      configVersion: Number(row.config_version),
      config: row.config ?? {},
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function finishEventInTx(
  client: PoolClient,
  event: ClaimedEvent,
  status: "PROCESSED" | "ACTION_REQUIRED" | "IGNORED_OLD",
  errorCode: string | null = null,
  error: string | null = null,
  providerAttempts = 0,
) {
  const updated = await client.query(
    `UPDATE bms_delivery_events
        SET processing_status = $4, processed_at = CASE WHEN $4 IN ('PROCESSED','IGNORED_OLD') THEN now() ELSE NULL END,
            error_code = $5, last_error = $6,
            provider_call_attempts = provider_call_attempts + $7,
            claimed_at = NULL, claim_token = NULL, updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND claim_token = $3 AND processing_status = 'PROCESSING'`,
    [event.tenant_id, event.id, event.claim_token, status, errorCode, error?.slice(0, 500) ?? null, providerAttempts],
  );
  if ((updated.rowCount ?? 0) !== 1) throw new Error("DELIVERY_EVENT_CLAIM_LOST");
}

async function markEventFailure(
  event: ClaimedEvent,
  retryable: boolean,
  code: string,
  detail: string,
  providerAttempts = 0,
) {
  const client = await getClient();
  try {
    await beginTenantTx(client, event.tenant_id);
    const retry = retryable && event.attempts < 10;
    const delaySeconds = Math.min(900, 5 * 2 ** Math.min(event.attempts, 8));
    const updated = await client.query(
      `UPDATE bms_delivery_events
          SET processing_status = $4,
              available_at = CASE WHEN $4 = 'RETRY' THEN now() + ($5 * interval '1 second') ELSE available_at END,
              error_code = $6, last_error = $7,
              provider_call_attempts = provider_call_attempts + $8,
              claimed_at = NULL, claim_token = NULL, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND claim_token = $3 AND processing_status = 'PROCESSING'`,
      [
        event.tenant_id,
        event.id,
        event.claim_token,
        retry ? "RETRY" : "DEAD_LETTER",
        delaySeconds,
        code,
        detail.slice(0, 500),
        providerAttempts,
      ],
    );
    if ((updated.rowCount ?? 0) !== 1) throw new Error("DELIVERY_EVENT_CLAIM_LOST");
    if (providerAttempts > 0) {
      const healthStatus = code === "AUTH_FAILED" ? "AUTH_FAILED"
        : code === "RATE_LIMITED" ? "RATE_LIMITED" : "DEGRADED";
      await client.query(
        `UPDATE bms_delivery_integrations
            SET health_status = CASE WHEN active THEN $3 ELSE 'DISABLED' END,
                last_error = $4, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [event.tenant_id, event.integration_id, healthStatus, code],
      );
    }
    await client.query("COMMIT");
    return retry ? "RETRY" as const : "DEAD_LETTER" as const;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function markEventActionRequired(
  event: ClaimedEvent,
  code: string,
  detail: string,
  providerAttempts = 0,
) {
  const client = await getClient();
  try {
    await beginTenantTx(client, event.tenant_id);
    await finishEventInTx(client, event, "ACTION_REQUIRED", code, detail, providerAttempts);
    await client.query("COMMIT");
    return "ACTION_REQUIRED" as const;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function recheckIntegrationInTx(
  client: PoolClient,
  context: IntegrationContext,
  event: ClaimedEvent,
  providerAttempts: number,
): Promise<boolean> {
  const result = await client.query<{
    provider: DeliveryProvider;
    environment: "SANDBOX" | "LIVE";
    active: boolean;
    rollout_mode: "OFF" | "SHADOW" | "LIVE";
    health_status: string;
    config_version: string | number;
    credential_expires_at: Date | string | null;
  }>(
    `SELECT provider, environment, active, rollout_mode, health_status,
            config_version, credential_expires_at
       FROM bms_delivery_integrations
      WHERE tenant_id = $1 AND id = $2
      FOR UPDATE`,
    [context.tenantId, context.integrationId],
  );
  const current = result.rows[0];
  if (!current || !current.active || current.rollout_mode === "OFF") {
    await finishEventInTx(client, event, "ACTION_REQUIRED", "INTEGRATION_DISABLED",
      "Integration was disabled while the provider order was being fetched", providerAttempts);
    return false;
  }
  if (current.provider !== context.provider || current.environment !== context.environment
    || current.rollout_mode !== context.rolloutMode
    || Number(current.config_version) !== context.configVersion) {
    await finishEventInTx(client, event, "ACTION_REQUIRED", "INTEGRATION_CONFIG_CHANGED",
      "Integration configuration changed while the provider order was being fetched", providerAttempts);
    return false;
  }
  if (!["HEALTHY", "DEGRADED"].includes(current.health_status)) {
    await finishEventInTx(client, event, "ACTION_REQUIRED", "INTEGRATION_UNHEALTHY",
      "Integration health no longer permits delivery intake", providerAttempts);
    return false;
  }
  if (current.credential_expires_at && Date.parse(String(current.credential_expires_at)) <= Date.now()) {
    await finishEventInTx(client, event, "ACTION_REQUIRED", "CREDENTIAL_EXPIRED",
      "Integration credentials expired before the local order write", providerAttempts);
    return false;
  }
  if (providerAttempts > 0) {
    await client.query(
      `UPDATE bms_delivery_integrations
          SET health_status = 'HEALTHY', last_successful_check_at = now(), last_error = NULL, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [context.tenantId, context.integrationId],
    );
    await client.query(
      `UPDATE bms_delivery_events
          SET provider_call_attempts = provider_call_attempts + $4, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND claim_token = $3 AND processing_status = 'PROCESSING'`,
      [event.tenant_id, event.id, event.claim_token, providerAttempts],
    );
  }
  return true;
}

async function resolveMappingsInTx(
  client: PoolClient,
  context: IntegrationContext,
  providerStoreId: string,
  order: NormalizedProviderOrder,
): Promise<{ ok: true; locationId: string; locationMappingId: string; mappings: Mapping[] } | { ok: false; code: string; detail: string }> {
  const location = await client.query<{ id: string; location_id: string }>(
    `SELECT id, location_id FROM bms_delivery_location_mappings
      WHERE tenant_id = $1 AND integration_id = $2 AND provider_store_id = $3 AND active
      FOR SHARE`,
    [context.tenantId, context.integrationId, providerStoreId],
  );
  if (!location.rows[0]) return { ok: false, code: "UNMAPPED_STORE", detail: "Provider store is not mapped to an active branch" };

  const intake = await client.query<{ scope: string; reason: string | null }>(
    `SELECT scope, reason FROM bms_delivery_intake_controls
      WHERE tenant_id = $1 AND desired_state = 'PAUSED'
        AND (
          (scope = 'DELIVERY_PLATFORMS' AND location_id IS NULL AND integration_id IS NULL)
          OR (scope = 'ALL_ONLINE' AND location_id IS NULL AND integration_id IS NULL)
          OR (scope = 'BRANCH' AND location_id = $2 AND integration_id IS NULL)
          OR (scope = 'PROVIDER' AND location_id = $2 AND integration_id = $3)
        )
      ORDER BY CASE scope WHEN 'ALL_ONLINE' THEN 1 WHEN 'DELIVERY_PLATFORMS' THEN 2
               WHEN 'BRANCH' THEN 3 ELSE 4 END
      LIMIT 1`,
    [context.tenantId, location.rows[0].location_id, context.integrationId],
  );
  if (intake.rows[0]) {
    return { ok: false, code: "INTAKE_PAUSED", detail: `Delivery intake is paused at ${intake.rows[0].scope} scope` };
  }

  const mappings: Mapping[] = [];
  for (const line of order.items) {
    const item = await client.query<{
      product_sku: string;
      size: string;
      mapping_status: string;
      provider_price_snapshot: string | null;
    }>(
      `SELECT product_sku, size, mapping_status, provider_price_snapshot
         FROM bms_delivery_menu_mappings
        WHERE tenant_id = $1 AND integration_id = $2 AND location_mapping_id = $3
          AND mapping_kind IN ('ITEM','VARIANT') AND provider_item_id = $4
          AND ((mapping_kind = 'ITEM' AND provider_variant_id IS NULL)
            OR (mapping_kind = 'VARIANT' AND provider_variant_id IS NOT DISTINCT FROM $5))
        ORDER BY (mapping_kind = 'VARIANT') DESC
        LIMIT 1
        FOR SHARE`,
      [context.tenantId, context.integrationId, location.rows[0].id, line.providerItemId, line.providerVariantId],
    );
    const mapped = item.rows[0];
    if (!mapped || mapped.mapping_status !== "VERIFIED") {
      return { ok: false, code: mapped?.mapping_status === "STALE" ? "STALE_MAPPING" : "UNMAPPED_ITEM", detail: `Item ${line.providerItemId} is not VERIFIED` };
    }
    if (mapped.provider_price_snapshot === null) {
      return { ok: false, code: "MAPPING_PRICE_REQUIRED", detail: `Item ${line.providerItemId} has no verified provider price snapshot` };
    }
    if (Math.abs(Number(mapped.provider_price_snapshot) - line.unitPrice) > 0.01) {
      return { ok: false, code: "MAPPING_PRICE_MISMATCH", detail: `Item ${line.providerItemId} price differs from its verified mapping snapshot` };
    }
    const modifierCodes: string[] = [];
    const modifierMappings: Mapping["modifierMappings"] = [];
    for (const modifier of line.modifiers) {
      const mod = await client.query<{ modifier_code: string; mapping_status: string }>(
        `SELECT modifier_code, mapping_status FROM bms_delivery_menu_mappings
          WHERE tenant_id = $1 AND integration_id = $2 AND location_mapping_id = $3
            AND mapping_kind = 'MODIFIER' AND provider_item_id = $4
            AND provider_modifier_id = $5
            AND (provider_variant_id IS NULL OR provider_variant_id IS NOT DISTINCT FROM $6)
          ORDER BY (provider_variant_id IS NOT NULL) DESC
          LIMIT 1 FOR SHARE`,
        [context.tenantId, context.integrationId, location.rows[0].id, line.providerItemId,
          modifier.providerModifierId, line.providerVariantId],
      );
      if (!mod.rows[0] || mod.rows[0].mapping_status !== "VERIFIED" || !mod.rows[0].modifier_code) {
        return { ok: false, code: "UNMAPPED_MODIFIER", detail: `Modifier ${modifier.providerModifierId} is not VERIFIED` };
      }
      modifierMappings.push({
        providerModifierId: modifier.providerModifierId,
        modifierCode: mod.rows[0].modifier_code,
      });
      for (let count = 0; count < modifier.quantity; count += 1) modifierCodes.push(mod.rows[0].modifier_code);
    }
    mappings.push({ line, sku: mapped.product_sku, size: mapped.size, modifierCodes, modifierMappings });
  }
  return { ok: true, locationId: location.rows[0].location_id, locationMappingId: location.rows[0].id, mappings };
}

function orderChannel(provider: DeliveryProvider): "grabfood" | "lineman" | "foodpanda" {
  return provider.toLowerCase() as "grabfood" | "lineman" | "foodpanda";
}

function providerStatusRank(status: string | null) {
  switch (status) {
    case "RECEIVED": return 10;
    case "READY_FOR_PICKUP": return 20;
    case "DISPATCHED": return 30;
    case "DELIVERED": return 40;
    case "CANCELLED": return 100;
    default: return null;
  }
}

async function persistProviderOrderInTx(
  client: PoolClient,
  context: IntegrationContext,
  event: ClaimedEvent,
  order: NormalizedProviderOrder,
  initialProviderStatus: string,
): Promise<"PROCESSED" | "ACTION_REQUIRED" | "IGNORED_OLD"> {
  const existing = await client.query<{
    id: string; provider_version: string | null; provider_status: string | null;
    local_status: string; bms_order_id: string | null; location_id: string;
  }>(
    `SELECT id, provider_version, provider_status, local_status, bms_order_id, location_id
       FROM bms_delivery_orders
      WHERE tenant_id = $1 AND provider = $2 AND provider_order_id = $3
      FOR UPDATE`,
    [context.tenantId, context.provider, order.providerOrderId],
  );
  if (existing.rows[0]) {
    const current = existing.rows[0];
    const currentVersionMs = current.provider_version ? Date.parse(current.provider_version) : Number.NaN;
    const incomingVersionMs = order.providerVersion ? Date.parse(order.providerVersion) : Number.NaN;
    const currentRank = providerStatusRank(current.provider_status);
    const incomingRank = providerStatusRank(order.providerStatus);
    const stateRegression = currentRank !== null && incomingRank !== null
      && (currentRank === 100 ? incomingRank !== 100 : incomingRank < currentRank);
    if ((Number.isFinite(currentVersionMs) && Number.isFinite(incomingVersionMs) && currentVersionMs > incomingVersionMs)
      || stateRegression) {
      await client.query(
        `INSERT INTO bms_delivery_order_events
           (tenant_id, delivery_order_id, event_kind, actor_type, source, safe_detail, occurred_at)
         VALUES ($1,$2,'OLD_PROVIDER_EVENT','WEBHOOK',$3,$4::jsonb,COALESCE($5,now()))`,
        [context.tenantId, current.id, context.provider, JSON.stringify({ providerStatus: order.providerStatus, stateRegression }), order.providerOccurredAt],
      );
      await finishEventInTx(client, event, "IGNORED_OLD", "OLD_PROVIDER_EVENT");
      return "IGNORED_OLD";
    }
    const terminalConflict = current.local_status === "COMPLETED" && order.providerStatus === "CANCELLED"
      || current.local_status === "CANCELLED" && order.providerStatus !== "CANCELLED";
    await client.query(
      `UPDATE bms_delivery_orders
          SET provider_status = $4, provider_version = $5, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND integration_id = $3`,
      [context.tenantId, current.id, context.integrationId, order.providerStatus, order.providerVersion],
    );
    await client.query(
      `INSERT INTO bms_delivery_order_events
         (tenant_id, delivery_order_id, event_kind, actor_type, source, safe_detail, occurred_at)
       VALUES
         ($1,$2,'INITIAL_PROVIDER_EVENT','WEBHOOK',$3,$4::jsonb,COALESCE($5,now())),
         ($1,$2,'LATEST_PROVIDER_SNAPSHOT','JOB',$3,$6::jsonb,COALESCE($7,now()))`,
      [
        context.tenantId, current.id, context.provider,
        JSON.stringify({ providerStatus: initialProviderStatus, providerVersion: event.provider_version }),
        event.provider_occurred_at,
        JSON.stringify({ providerStatus: order.providerStatus, providerVersion: order.providerVersion }),
        order.providerOccurredAt,
      ],
    );
    if (current.bms_order_id) {
      const now = new Date().toISOString();
      await enqueueRealtimeEventInTx(client, realtimeEvent({
        eventId: crypto.randomUUID(),
        eventType: "order.fulfillment_changed",
        tenantId: context.tenantId,
        locationId: current.location_id,
        actorType: "WEBHOOK",
        entityType: "order",
        entityId: current.bms_order_id,
        updatedAt: now,
        occurredAt: now,
        payload: { status: order.providerStatus, source: "delivery_provider" },
      }));
    }
    if (order.providerStatus === "DISPATCHED") {
      await client.query(
        `UPDATE bms_delivery_handoffs
            SET provider_ack_status = 'CONFIRMED', provider_ack_at = COALESCE(provider_ack_at, now())
          WHERE tenant_id = $1 AND delivery_order_id = $2`,
        [context.tenantId, current.id],
      );
    }
    if (order.providerStatus === "DELIVERED" && current.local_status === "HANDED_OVER" && current.bms_order_id) {
      await client.query(
        `UPDATE bms_delivery_orders
            SET local_status = 'COMPLETED', completed_at = COALESCE(completed_at, now()), updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND local_status = 'HANDED_OVER'`,
        [context.tenantId, current.id],
      );
      await client.query(
        `UPDATE bms_orders SET status = 'COMPLETED', updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND status = 'SHIPPED'`,
        [context.tenantId, current.bms_order_id],
      );
    }
    if (terminalConflict || order.providerStatus === "CANCELLED") {
      await finishEventInTx(
        client,
        event,
        "ACTION_REQUIRED",
        terminalConflict ? "TERMINAL_STATE_CONFLICT" : "PROVIDER_CANCELLATION_REVIEW",
        terminalConflict
          ? `Local ${current.local_status} conflicts with provider ${order.providerStatus}`
          : "Provider cancellation must run through the existing cancellation/refund workflow",
      );
      return "ACTION_REQUIRED";
    }
    await finishEventInTx(client, event, "PROCESSED");
    return "PROCESSED";
  }

  if (initialProviderStatus !== "RECEIVED") {
    await finishEventInTx(
      client,
      event,
      "ACTION_REQUIRED",
      "UNKNOWN_ORDER_NON_INITIAL_EVENT",
      `Received initial status ${initialProviderStatus} before the provider order existed locally`,
    );
    return "ACTION_REQUIRED";
  }
  if (order.providerStatus === "CANCELLED") {
    await finishEventInTx(client, event, "ACTION_REQUIRED", "PROVIDER_CANCELLED_BEFORE_INTAKE",
      "Provider cancelled the order before a local order could be created");
    return "ACTION_REQUIRED";
  }

  const currency = await client.query<{ currency: string }>(
    `SELECT COALESCE(NULLIF(upper(btrim(currency)), ''), 'THB') AS currency
       FROM bms_store_profile
      WHERE tenant_id = $1`,
    [context.tenantId],
  );
  const storeCurrency = currency.rows[0]?.currency ?? "THB";
  const providerCurrency = order.currency.trim().toUpperCase();
  const configuredCurrency = typeof context.config.currency === "string"
    ? context.config.currency.trim().toUpperCase() : null;
  if (providerCurrency !== storeCurrency || (configuredCurrency && configuredCurrency !== storeCurrency)) {
    await finishEventInTx(client, event, "ACTION_REQUIRED", "DELIVERY_CURRENCY_MISMATCH",
      `Provider/config currency does not match store currency ${storeCurrency}`);
    return "ACTION_REQUIRED";
  }

  const resolved = await resolveMappingsInTx(client, context, order.providerStoreId, order);
  if (!resolved.ok) {
    await finishEventInTx(client, event, "ACTION_REQUIRED", resolved.code, resolved.detail);
    return "ACTION_REQUIRED";
  }

  let startPreparationAt: string | null = null;
  if (order.scheduled) {
    const leadMinutes = Number(context.config.scheduledPrepLeadMinutes);
    if (!order.preparationTargetAt || !Number.isInteger(leadMinutes) || leadMinutes < 1 || leadMinutes > 240) {
      await finishEventInTx(
        client,
        event,
        "ACTION_REQUIRED",
        "SCHEDULED_PREP_POLICY_REQUIRED",
        "Scheduled orders require a provider-confirmed preparation target and scheduledPrepLeadMinutes (1-240)",
      );
      return "ACTION_REQUIRED";
    }
    startPreparationAt = new Date(Date.parse(order.preparationTargetAt) - leadMinutes * 60_000).toISOString();
  }

  let bmsOrderId: string | null = null;
  const orderItemIds = new Map<string, string[]>();
  if (context.rolloutMode === "LIVE") {
    const items: OrderItemInput[] = resolved.mappings.map((mapping) => ({
      sku: mapping.sku,
      size: mapping.size,
      qty: mapping.line.quantity,
      modifierCodes: mapping.modifierCodes,
    }));
    const created = await createOrderInTx(client, {
      tenantId: context.tenantId,
      channel: orderChannel(context.provider),
      customerRef: null,
      locationId: resolved.locationId,
      fulfillmentType: order.orderType,
      promisedAt: order.promisedFor,
      items,
    });
    if (created.status !== "CREATED") {
      throw new DeliveryActionRequiredError(created.status, JSON.stringify(created).slice(0, 500));
    }
    if (Math.abs(created.subtotal - order.itemSubtotal) > 0.01) {
      // createOrderInTx has already reserved stock; the caller will commit only
      // after this function returns. Throwing guarantees the whole event write,
      // order and reservation roll back together, then the retry is classified.
      throw new Error(`DELIVERY_PRICE_MISMATCH:${created.subtotal}:${order.itemSubtotal}`);
    }
    bmsOrderId = created.orderId;
    const orderItems = await client.query<{ id: string; product_sku: string; size: string }>(
      `SELECT id, product_sku, size FROM bms_order_items
        WHERE tenant_id = $1 AND order_id = $2 ORDER BY id`,
      [context.tenantId, bmsOrderId],
    );
    for (const row of orderItems.rows) {
      const key = `${row.product_sku}\u0000${row.size}`;
      const ids = orderItemIds.get(key) ?? [];
      ids.push(row.id);
      orderItemIds.set(key, ids);
    }
    await client.query(
      `INSERT INTO bms_payments
         (tenant_id, order_id, method, amount, status, slip_ref, note, verified_by, confirmed_at)
       VALUES ($1,$2,'PLATFORM_SETTLEMENT',$3,'CONFIRMED',$4,$5,'system:delivery-platform',now())`,
      [context.tenantId, bmsOrderId, created.amountDue, order.providerOrderId, `${context.provider} platform-collected`],
    );
    await client.query(
      `UPDATE bms_orders SET status = 'PAID', paid_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'`,
      [context.tenantId, bmsOrderId],
    );
  }

  const delivery = await client.query<{ id: string }>(
    `INSERT INTO bms_delivery_orders (
       tenant_id, integration_id, location_mapping_id, location_id, bms_order_id, provider, provider_order_id,
       provider_display_number, local_status, provider_status, provider_version, payment_status,
       order_type, acceptance_deadline_at, scheduled_fulfillment_at, start_preparation_at,
       promised_ready_at, currency, customer_amount, transport_type,
       item_subtotal, delivery_fee, service_fee, small_order_fee, tax_amount,
       expected_settlement_amount, sanitized_metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
               CASE WHEN $5::uuid IS NULL THEN 'UNVERIFIED' ELSE 'PLATFORM_CONFIRMED' END,
               $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::jsonb)
     RETURNING id`,
    [
      context.tenantId, context.integrationId, resolved.locationMappingId, resolved.locationId, bmsOrderId, context.provider,
      order.providerOrderId, order.providerDisplayNumber, "AWAITING_ACCEPTANCE",
      order.providerStatus, order.providerVersion, order.orderType,
      order.acceptanceDeadlineAt, order.scheduled ? order.promisedFor : null, startPreparationAt,
      order.preparationTargetAt, order.currency,
      order.customerAmount, order.transportType, order.itemSubtotal, order.deliveryFee, order.serviceFee,
      order.smallOrderFee, order.taxAmount, order.itemSubtotal,
      JSON.stringify({ rolloutMode: context.rolloutMode, sourceEventId: event.external_event_id,
        estimatedDeliveryAt: order.estimatedDeliveryAt,
        promisedFulfillmentAt: order.promisedFor }),
    ],
  );
  for (const mapping of resolved.mappings) {
    const line = await client.query<{ id: string }>(
      `INSERT INTO bms_delivery_order_lines (
         tenant_id, delivery_order_id, provider_line_id, provider_item_id, provider_variant_id,
         bms_order_item_id, name_snapshot, quantity, unit_price, discount_amount,
         mapped_sku, mapped_size, source_version
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        context.tenantId, delivery.rows[0].id, mapping.line.providerLineId,
        mapping.line.providerItemId, mapping.line.providerVariantId,
        orderItemIds.get(`${mapping.sku}\u0000${mapping.size}`)?.shift() ?? null,
        mapping.line.name, mapping.line.quantity, mapping.line.unitPrice,
        mapping.line.discountAmount, mapping.sku, mapping.size, order.providerVersion,
      ],
    );
    for (const modifier of mapping.line.modifiers) {
      const code = mapping.modifierMappings.find(
        (candidate) => candidate.providerModifierId === modifier.providerModifierId,
      )?.modifierCode ?? null;
      await client.query(
        `INSERT INTO bms_delivery_order_modifiers (
           tenant_id, delivery_order_line_id, provider_modifier_id, provider_name_snapshot,
           mapped_modifier_code, quantity, price_snapshot
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [context.tenantId, line.rows[0].id, modifier.providerModifierId, modifier.name, code, modifier.quantity, modifier.price],
      );
    }
  }
  await client.query(
    `INSERT INTO bms_delivery_order_events
       (tenant_id, delivery_order_id, event_kind, actor_type, source, safe_detail, occurred_at)
     VALUES
       ($1,$2,'INITIAL_PROVIDER_EVENT','WEBHOOK',$3,$4::jsonb,COALESCE($5,now())),
       ($1,$2,'LATEST_PROVIDER_SNAPSHOT','JOB',$3,$6::jsonb,COALESCE($7,now()))`,
    [
      context.tenantId, delivery.rows[0].id, context.provider,
      JSON.stringify({ providerStatus: initialProviderStatus, providerVersion: event.provider_version }),
      event.provider_occurred_at,
      JSON.stringify({ providerStatus: order.providerStatus, providerVersion: order.providerVersion }),
      order.providerOccurredAt,
    ],
  );
  await client.query(
    `INSERT INTO bms_delivery_order_events
       (tenant_id, delivery_order_id, event_kind, actor_type, source, safe_detail, occurred_at)
     VALUES ($1,$2,$3,'WEBHOOK',$4,$5::jsonb,COALESCE($6,now()))`,
    [
      context.tenantId, delivery.rows[0].id,
      context.rolloutMode === "SHADOW" ? "SHADOW_ORDER_CAPTURED" : "ORDER_CREATED",
      context.provider,
      JSON.stringify({ providerStatus: order.providerStatus, bmsOrderCreated: Boolean(bmsOrderId) }),
      order.providerOccurredAt,
    ],
  );
  await client.query(
    `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
     VALUES ($1,'system:delivery-webhook',$2,$3,$4::jsonb)`,
    [
      context.tenantId,
      context.rolloutMode === "SHADOW" ? "delivery.order_shadowed" : "delivery.order_created",
      delivery.rows[0].id,
      JSON.stringify({ provider: context.provider, locationId: resolved.locationId, bmsOrderId }),
    ],
  );
  await finishEventInTx(client, event, "PROCESSED");
  return "PROCESSED";
}

export async function processClaimedDeliveryEvent(event: ClaimedEvent) {
  const context = await loadIntegrationContext(event);
  if (!context || !context.active || context.rolloutMode === "OFF") {
    return markEventActionRequired(event, "INTEGRATION_DISABLED", "Integration is missing or disabled");
  }
  const providerOrderId = typeof event.sanitized_payload?.providerOrderId === "string"
    ? event.sanitized_payload.providerOrderId
    : null;
  const providerStoreId = typeof event.sanitized_payload?.providerStoreId === "string"
    ? event.sanitized_payload.providerStoreId
    : null;
  if (!providerOrderId || !providerStoreId) {
    return markEventActionRequired(event, "INVALID_EVENT_POINTER", "Sanitized event has no order/store identity");
  }
  const initialProviderStatus = typeof event.sanitized_payload?.providerStatus === "string"
    ? event.sanitized_payload.providerStatus.trim().toUpperCase()
    : "";
  const initialTransportType = event.sanitized_payload?.transportType;
  if (!initialProviderStatus) {
    return markEventActionRequired(event, "INVALID_INITIAL_STATUS", "Sanitized event has no provider status");
  }
  if (context.provider === "FOODPANDA"
    && initialTransportType !== "LOGISTICS_DELIVERY" && initialTransportType !== "VENDOR_DELIVERY") {
    return markEventActionRequired(event, "INVALID_TRANSPORT_TYPE", "Foodpanda event has no recognized transport type");
  }
  const adapter = getDeliveryPlatformAdapter(context.provider);
  const fetched = await adapter.fetchOrder(configOf(context), { providerOrderId, providerStoreId });
  if (!fetched.ok) {
    if (fetched.code === "INVALID_TRANSPORT_TYPE") {
      return markEventActionRequired(event, fetched.code, fetched.detail, fetched.providerAttempts ?? 0);
    }
    return markEventFailure(event, fetched.retryable, fetched.code, fetched.detail, fetched.providerAttempts ?? 0);
  }
  const providerAttempts = fetched.providerAttempts ?? 0;

  const client = await getClient();
  try {
    await beginTenantTx(client, event.tenant_id);
    if (!(await recheckIntegrationInTx(client, context, event, providerAttempts))) {
      await client.query("COMMIT");
      return "ACTION_REQUIRED" as const;
    }
    if (fetched.value.providerOrderId !== providerOrderId || fetched.value.providerStoreId !== providerStoreId) {
      await finishEventInTx(client, event, "ACTION_REQUIRED", "PROVIDER_IDENTITY_MISMATCH",
        "Fetched provider order/store identity does not match the verified webhook pointer");
      await client.query("COMMIT");
      return "ACTION_REQUIRED" as const;
    }
    if (context.provider === "FOODPANDA" && fetched.value.transportType !== initialTransportType) {
      await finishEventInTx(client, event, "ACTION_REQUIRED", "TRANSPORT_TYPE_CHANGED",
        "Provider transport type changed between webhook and fetched order");
      await client.query("COMMIT");
      return "ACTION_REQUIRED" as const;
    }
    const outcome = await persistProviderOrderInTx(client, context, event, fetched.value, initialProviderStatus);
    await client.query("COMMIT");
    return outcome;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    const detail = error instanceof Error ? error.message : "Delivery event processing failed";
    if (detail.startsWith("DELIVERY_PRICE_MISMATCH:") || error instanceof DeliveryActionRequiredError) {
      // The order transaction was rolled back. Record a deterministic human
      // task in a fresh tenant transaction instead of retrying forever.
      const followup = await getClient();
      try {
        await beginTenantTx(followup, event.tenant_id);
        await finishEventInTx(
          followup,
          event,
          "ACTION_REQUIRED",
          error instanceof DeliveryActionRequiredError ? error.code : "PRICE_MISMATCH",
          detail,
          providerAttempts,
        );
        await followup.query("COMMIT");
        return "ACTION_REQUIRED" as const;
      } catch (followupError) {
        try { await followup.query("ROLLBACK"); } catch {}
        throw followupError;
      } finally {
        followup.release();
      }
    }
    return markEventFailure(event, true, "PROCESSING_ERROR", "Delivery event processing failed", providerAttempts);
  } finally {
    client.release();
  }
}

export async function runDeliveryEventBatch(limit = 25): Promise<DeliveryEventBatchResult> {
  const bounded = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const claimed = await query<ClaimedEvent>(
    `SELECT * FROM public.bms_claim_delivery_events($1, $2)`,
    [bounded, 60_000],
  );
  const result: DeliveryEventBatchResult = {
    claimed: claimed.rows.length,
    processed: 0,
    actionRequired: 0,
    retried: 0,
    deadLettered: 0,
  };
  for (const event of claimed.rows) {
    const outcome = await processClaimedDeliveryEvent(event);
    if (outcome === "PROCESSED" || outcome === "IGNORED_OLD") result.processed += 1;
    else if (outcome === "ACTION_REQUIRED") result.actionRequired += 1;
    else if (outcome === "RETRY") result.retried += 1;
    else result.deadLettered += 1;
  }
  return result;
}
