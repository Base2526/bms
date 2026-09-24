import { getClient } from "@/lib/db";
import { decryptSecret, encryptSecret, maskSecret } from "./crypto";
import { beginTenantTx } from "./tenant";
import { DELIVERY_CAPABILITIES, getDeliveryPlatformAdapter } from "./deliveryPlatforms";
import { DELIVERY_PROVIDERS, type DeliveryAdapterConfig, type DeliveryEnvironment, type DeliveryProvider } from "./deliveryPlatforms/types";

const SENSITIVE_CONFIG_KEY = /(secret|token|password|credential|private.?key)/i;

function cleanText(value: unknown, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function cleanConfig(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 30) throw new Error("DELIVERY_CONFIG_TOO_LARGE");
  const output: Record<string, string | number | boolean> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || SENSITIVE_CONFIG_KEY.test(key)) {
      throw new Error("DELIVERY_CONFIG_KEY_NOT_ALLOWED");
    }
    if (typeof rawValue === "string") output[key] = rawValue.trim().slice(0, 500);
    else if (typeof rawValue === "number" && Number.isFinite(rawValue)) output[key] = rawValue;
    else if (typeof rawValue === "boolean") output[key] = rawValue;
    else throw new Error("DELIVERY_CONFIG_VALUE_NOT_ALLOWED");
  }
  return output;
}

function providerOf(value: unknown): DeliveryProvider {
  const provider = String(value ?? "").toUpperCase() as DeliveryProvider;
  if (!DELIVERY_PROVIDERS.includes(provider)) throw new Error("DELIVERY_PROVIDER_INVALID");
  return provider;
}

function environmentOf(value: unknown): DeliveryEnvironment {
  const environment = String(value ?? "").toUpperCase();
  if (environment !== "SANDBOX" && environment !== "LIVE") throw new Error("DELIVERY_ENVIRONMENT_INVALID");
  return environment;
}

function rolloutOf(value: unknown): "OFF" | "SHADOW" | "LIVE" {
  const rollout = String(value ?? "").toUpperCase();
  if (!(["OFF", "SHADOW", "LIVE"] as const).includes(rollout as any)) throw new Error("DELIVERY_ROLLOUT_INVALID");
  return rollout as "OFF" | "SHADOW" | "LIVE";
}

export async function listDeliveryIntegrations(tenantId: string) {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const result = await client.query<any>(
    `SELECT i.id, i.provider, i.environment, i.rollout_mode, i.active,
            i.outbound_commands_enabled, i.client_id, i.client_secret_encrypted,
            i.access_token_encrypted, i.refresh_token_encrypted, i.webhook_secret_encrypted,
            i.config, i.api_version, i.credential_expires_at, i.health_status,
            i.last_successful_check_at, i.last_webhook_at, i.last_error,
            COUNT(DISTINCT lm.id)::integer AS location_count,
            COUNT(DISTINCT mm.id) FILTER (WHERE mm.mapping_status = 'VERIFIED')::integer AS verified_mapping_count,
            COUNT(DISTINCT mm.id) FILTER (WHERE mm.mapping_status IN ('UNMAPPED','STALE'))::integer AS mapping_action_count
       FROM bms_delivery_integrations i
       LEFT JOIN bms_delivery_location_mappings lm
         ON lm.tenant_id = i.tenant_id AND lm.integration_id = i.id
       LEFT JOIN bms_delivery_menu_mappings mm
         ON mm.tenant_id = i.tenant_id AND mm.integration_id = i.id
      WHERE i.tenant_id = $1
      GROUP BY i.id
      ORDER BY i.provider, i.environment`,
    [tenantId],
  );
    await client.query("COMMIT");
    return result.rows.map((row: any) => ({
    id: row.id,
    provider: row.provider,
    environment: row.environment,
    rolloutMode: row.rollout_mode,
    active: row.active,
    outboundCommandsEnabled: row.outbound_commands_enabled,
    clientId: row.client_id,
    hasClientSecret: Boolean(row.client_secret_encrypted),
    hasAccessToken: Boolean(row.access_token_encrypted),
    hasRefreshToken: Boolean(row.refresh_token_encrypted),
    hasWebhookSecret: Boolean(row.webhook_secret_encrypted),
    clientSecretMasked: maskSecret(decryptSecret(row.client_secret_encrypted)),
    accessTokenMasked: maskSecret(decryptSecret(row.access_token_encrypted)),
    webhookSecretMasked: maskSecret(decryptSecret(row.webhook_secret_encrypted)),
    config: row.config ?? {},
    apiVersion: row.api_version,
    credentialExpiresAt: row.credential_expires_at,
    healthStatus: row.health_status,
    lastSuccessfulCheckAt: row.last_successful_check_at,
    lastWebhookAt: row.last_webhook_at,
    lastError: row.last_error,
    locationCount: Number(row.location_count),
    verifiedMappingCount: Number(row.verified_mapping_count),
    mappingActionCount: Number(row.mapping_action_count),
    capabilities: DELIVERY_CAPABILITIES[row.provider as DeliveryProvider],
    }));
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

export async function upsertDeliveryIntegration(input: {
  tenantId: string;
  actorUserId: string;
  id?: string | null;
  provider: unknown;
  environment: unknown;
  rolloutMode: unknown;
  active: boolean;
  outboundCommandsEnabled: boolean;
  clientId?: unknown;
  clientSecret?: unknown;
  accessToken?: unknown;
  refreshToken?: unknown;
  webhookSecret?: unknown;
  config?: unknown;
  apiVersion?: unknown;
  credentialExpiresAt?: unknown;
}) {
  const provider = providerOf(input.provider);
  const environment = environmentOf(input.environment);
  const rolloutMode = rolloutOf(input.rolloutMode);
  const config = cleanConfig(input.config);
  const apiVersion = cleanText(input.apiVersion, 100);
  if (rolloutMode !== "OFF" && !input.active) throw new Error("DELIVERY_ACTIVE_REQUIRED_FOR_ROLLOUT");
  if (rolloutMode === "LIVE" && DELIVERY_CAPABILITIES[provider].webhookOrders !== "VERIFIED") {
    throw new Error("DELIVERY_OFFICIAL_WEBHOOK_CONTRACT_REQUIRED");
  }
  if (environment === "LIVE" && rolloutMode === "LIVE"
    && (DELIVERY_CAPABILITIES[provider].fetchOrder !== "VERIFIED"
      || DELIVERY_CAPABILITIES[provider].acceptOrder !== "VERIFIED"
      || DELIVERY_CAPABILITIES[provider].rejectOrder !== "VERIFIED")) {
    throw new Error("DELIVERY_OFFICIAL_ORDER_LIFECYCLE_CONTRACT_REQUIRED");
  }
  if (input.outboundCommandsEnabled && (!input.active || rolloutMode !== "LIVE")) {
    throw new Error("DELIVERY_OUTBOUND_REQUIRES_LIVE_ROLLOUT");
  }
  if (rolloutMode !== "OFF" && provider === "FOODPANDA") {
    if (typeof config.chainId !== "string" || !config.chainId.trim()
      || typeof config.currency !== "string" || !/^[A-Za-z]{3}$/.test(config.currency)
      || typeof config.webhookAuthHeader !== "string" || !/^[A-Za-z0-9-]{1,80}$/.test(config.webhookAuthHeader)) {
      throw new Error("DELIVERY_FOODPANDA_CONTRACT_CONFIG_REQUIRED");
    }
  }
  const expiry = cleanText(input.credentialExpiresAt, 80);
  if (expiry && Number.isNaN(Date.parse(expiry))) throw new Error("DELIVERY_CREDENTIAL_EXPIRY_INVALID");
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    const restaurant = await client.query(
      `SELECT 1 FROM bms_store_profile
        WHERE tenant_id = $1 AND business_archetype = 'restaurant' FOR SHARE`,
      [input.tenantId],
    );
    if (!restaurant.rowCount) throw new Error("DELIVERY_RESTAURANT_REQUIRED");
    const current = input.id ? await client.query<any>(
      `SELECT * FROM bms_delivery_integrations WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [input.tenantId, input.id],
    ) : { rows: [] };
    if (input.id && !current.rows[0]) throw new Error("DELIVERY_INTEGRATION_NOT_FOUND");
    const old = current.rows[0];
    if (old && (old.provider !== provider || old.environment !== environment)) {
      throw new Error("DELIVERY_PROVIDER_ENVIRONMENT_IMMUTABLE");
    }
    const secret = (value: unknown, previous: string | null) => cleanText(value, 8000) ? encryptSecret(cleanText(value, 8000)) : previous;
    const values = {
      clientId: cleanText(input.clientId, 500) ?? old?.client_id ?? null,
      clientSecret: secret(input.clientSecret, old?.client_secret_encrypted ?? null),
      accessToken: secret(input.accessToken, old?.access_token_encrypted ?? null),
      refreshToken: secret(input.refreshToken, old?.refresh_token_encrypted ?? null),
      webhookSecret: secret(input.webhookSecret, old?.webhook_secret_encrypted ?? null),
    };
    if (rolloutMode !== "OFF" && (!values.webhookSecret || !apiVersion)) {
      throw new Error("DELIVERY_WEBHOOK_SECRET_AND_API_VERSION_REQUIRED");
    }
    if (input.outboundCommandsEnabled && !values.accessToken) throw new Error("DELIVERY_ACCESS_TOKEN_REQUIRED");
    const healthStatus = !input.active ? "DISABLED"
      : DELIVERY_CAPABILITIES[provider].webhookOrders === "VERIFIED" ? "DEGRADED" : "CONTRACT_BLOCKED";
    const saved = await client.query<{ id: string }>(
      `INSERT INTO bms_delivery_integrations (
         id, tenant_id, provider, environment, rollout_mode, active, outbound_commands_enabled,
         client_id, client_secret_encrypted, access_token_encrypted, refresh_token_encrypted,
         webhook_secret_encrypted, config, api_version, credential_expires_at, health_status,
         created_by, updated_by
       ) VALUES (COALESCE($1::uuid, gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$17)
       ON CONFLICT (tenant_id, provider, environment) DO UPDATE SET
         rollout_mode = EXCLUDED.rollout_mode, active = EXCLUDED.active,
         outbound_commands_enabled = EXCLUDED.outbound_commands_enabled,
         client_id = EXCLUDED.client_id, client_secret_encrypted = EXCLUDED.client_secret_encrypted,
         access_token_encrypted = EXCLUDED.access_token_encrypted,
         refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
         webhook_secret_encrypted = EXCLUDED.webhook_secret_encrypted,
         config = EXCLUDED.config, api_version = EXCLUDED.api_version,
         credential_expires_at = EXCLUDED.credential_expires_at,
         health_status = EXCLUDED.health_status, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING id`,
      [input.id ?? null, input.tenantId, provider, environment, rolloutMode, input.active,
        input.outboundCommandsEnabled, values.clientId, values.clientSecret, values.accessToken,
        values.refreshToken, values.webhookSecret, JSON.stringify(config), apiVersion,
        expiry ? new Date(expiry).toISOString() : null, healthStatus, input.actorUserId],
    );
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'delivery.integration_configured',$3,$4::jsonb)`,
      [input.tenantId, input.actorUserId, saved.rows[0].id,
        JSON.stringify({ provider, environment, rolloutMode, active: input.active, outboundCommandsEnabled: input.outboundCommandsEnabled,
          rotated: { clientSecret: Boolean(cleanText(input.clientSecret, 8000)), accessToken: Boolean(cleanText(input.accessToken, 8000)),
            refreshToken: Boolean(cleanText(input.refreshToken, 8000)), webhookSecret: Boolean(cleanText(input.webhookSecret, 8000)) } })],
    );
    await client.query("COMMIT");
    return { id: saved.rows[0].id };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function testDeliveryIntegration(tenantId: string, integrationId: string) {
  const reader = await getClient();
  let row: any;
  try {
    await beginTenantTx(reader, tenantId);
    const result = await reader.query<any>(
    `SELECT i.provider, i.environment, i.client_id, i.client_secret_encrypted,
            i.access_token_encrypted, i.refresh_token_encrypted, i.webhook_secret_encrypted,
            i.api_version, i.config, lm.provider_store_id
       FROM bms_delivery_integrations i
       LEFT JOIN LATERAL (
         SELECT provider_store_id FROM bms_delivery_location_mappings
          WHERE tenant_id = i.tenant_id AND integration_id = i.id AND active ORDER BY created_at LIMIT 1
       ) lm ON TRUE
      WHERE i.tenant_id = $1 AND i.id = $2`,
    [tenantId, integrationId],
  );
    row = result.rows[0];
    await reader.query("COMMIT");
  } catch (error) {
    try { await reader.query("ROLLBACK"); } catch {}
    throw error;
  } finally { reader.release(); }
  if (!row) return { ok: false, code: "NOT_FOUND", detail: "Integration not found" };
  const config: DeliveryAdapterConfig = {
    environment: row.environment,
    clientId: row.client_id,
    clientSecret: decryptSecret(row.client_secret_encrypted),
    accessToken: decryptSecret(row.access_token_encrypted),
    refreshToken: decryptSecret(row.refresh_token_encrypted),
    webhookSecret: decryptSecret(row.webhook_secret_encrypted),
    apiVersion: row.api_version,
    config: row.config ?? {},
  };
  const adapter = getDeliveryPlatformAdapter(row.provider);
  const checked = !row.provider_store_id || adapter.capabilities.fetchMenu !== "VERIFIED"
    ? { ok: false as const, code: "CONTRACT_BLOCKED" as const, retryable: false,
        detail: "Verified menu check and a mapped provider store are required" }
    : await adapter.fetchMenu(config, row.provider_store_id);
  const writer = await getClient();
  try {
    await beginTenantTx(writer, tenantId);
    await writer.query(
      `UPDATE bms_delivery_integrations
        SET health_status = $3, last_successful_check_at = CASE WHEN $3 = 'HEALTHY' THEN now() ELSE last_successful_check_at END,
            last_error = $4, updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
      [tenantId, integrationId, checked.ok ? "HEALTHY"
        : checked.code === "AUTH_FAILED" ? "AUTH_FAILED"
          : checked.code === "CONTRACT_BLOCKED" ? "CONTRACT_BLOCKED" : "DEGRADED",
        checked.ok ? null : checked.detail.slice(0, 500)],
    );
    await writer.query("COMMIT");
  } catch (error) {
    try { await writer.query("ROLLBACK"); } catch {}
    throw error;
  } finally { writer.release(); }
  return checked.ok ? { ok: true, source: checked.source } : checked;
}
