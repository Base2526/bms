import "server-only";

import { getClient, query } from "@/lib/db";
import { decryptSecret, encryptSecret, maskSecret } from "./crypto";
import { DELIVERY_CAPABILITIES } from "./deliveryPlatforms";
import { DELIVERY_PROVIDERS, type DeliveryEnvironment, type DeliveryProvider } from "./deliveryPlatforms/types";

const STATUSES = ["DRAFT", "CONTRACT_REVIEW", "SANDBOX", "CERTIFIED", "ACTIVE", "SUSPENDED"] as const;
const AUTHORITIES = ["UNCONFIRMED", "PLATFORM", "TENANT", "AUTHORIZATION_FLOW"] as const;
const AUTH_MODES = ["UNCONFIRMED", "OAUTH_CLIENT_CREDENTIALS", "API_KEY", "BEARER_TOKEN", "SIGNED_REQUEST", "CUSTOM"] as const;
const SENSITIVE_KEY = /(secret|token|password|credential|private.?key)/i;
const PROVIDER_SETTING_COLUMNS = `id, provider, environment, onboarding_status,
  credential_authority, authentication_mode, tenant_connections_enabled, partner_id, client_id,
  client_secret_encrypted, access_token_encrypted, refresh_token_encrypted,
  webhook_secret_encrypted, api_base_url, api_version, webhook_auth_header, contract_url,
  contract_version, contract_reviewed_at, credential_expires_at, config, last_test_status,
  last_tested_at, last_error, updated_at`;

type ProviderStatus = (typeof STATUSES)[number];
type CredentialAuthority = (typeof AUTHORITIES)[number];
type AuthenticationMode = (typeof AUTH_MODES)[number];

function enumValue<T extends readonly string[]>(value: unknown, allowed: T, code: string): T[number] {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!allowed.includes(normalized as T[number])) throw new DeliveryProviderSettingError(code, 400);
  return normalized as T[number];
}

function providerOf(value: unknown): DeliveryProvider {
  return enumValue(value, DELIVERY_PROVIDERS, "DELIVERY_PROVIDER_INVALID") as DeliveryProvider;
}

function environmentOf(value: unknown): DeliveryEnvironment {
  return enumValue(value, ["SANDBOX", "LIVE"] as const, "DELIVERY_ENVIRONMENT_INVALID") as DeliveryEnvironment;
}

function textValue(value: unknown, max: number): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().slice(0, max);
}

function secretValue(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  if (value.length > 8000) throw new DeliveryProviderSettingError("DELIVERY_SECRET_TOO_LARGE", 400);
  return value;
}

function httpsUrl(value: unknown, code: string): string | null {
  const text = textValue(value, 1000);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") throw new Error("https required");
    return url.toString();
  } catch {
    throw new DeliveryProviderSettingError(code, 400);
  }
}

function safeConfig(value: unknown): Record<string, string | number | boolean> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new DeliveryProviderSettingError("DELIVERY_CONFIG_INVALID", 400);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 30) throw new DeliveryProviderSettingError("DELIVERY_CONFIG_TOO_LARGE", 400);
  const output: Record<string, string | number | boolean> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || SENSITIVE_KEY.test(key)) {
      throw new DeliveryProviderSettingError("DELIVERY_CONFIG_KEY_NOT_ALLOWED", 400);
    }
    if (typeof rawValue === "string") output[key] = rawValue.trim().slice(0, 500);
    else if (typeof rawValue === "number" && Number.isFinite(rawValue)) output[key] = rawValue;
    else if (typeof rawValue === "boolean") output[key] = rawValue;
    else throw new DeliveryProviderSettingError("DELIVERY_CONFIG_VALUE_NOT_ALLOWED", 400);
  }
  return output;
}

function instant(value: unknown, code: string): string | null {
  const text = textValue(value, 80);
  if (!text) return null;
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) throw new DeliveryProviderSettingError(code, 400);
  return new Date(parsed).toISOString();
}

function providerActivationReady(provider: DeliveryProvider) {
  const capabilities = DELIVERY_CAPABILITIES[provider];
  return capabilities.webhookOrders === "VERIFIED"
    && capabilities.fetchOrder === "VERIFIED"
    && capabilities.rejectOrder === "VERIFIED";
}

export class DeliveryProviderSettingError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function maskedSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const plain = decryptSecret(stored);
  if (!plain) throw new Error("DELIVERY_PROVIDER_SECRET_DECRYPT_FAILED");
  return maskSecret(plain);
}

function publicRow(row: any) {
  return {
    id: row.id,
    provider: row.provider,
    environment: row.environment,
    onboardingStatus: row.onboarding_status,
    credentialAuthority: row.credential_authority,
    authenticationMode: row.authentication_mode,
    tenantConnectionsEnabled: row.tenant_connections_enabled,
    partnerId: row.partner_id,
    clientId: row.client_id,
    hasClientSecret: Boolean(row.client_secret_encrypted),
    hasAccessToken: Boolean(row.access_token_encrypted),
    hasRefreshToken: Boolean(row.refresh_token_encrypted),
    hasWebhookSecret: Boolean(row.webhook_secret_encrypted),
    clientSecretMasked: maskedSecret(row.client_secret_encrypted),
    accessTokenMasked: maskedSecret(row.access_token_encrypted),
    refreshTokenMasked: maskedSecret(row.refresh_token_encrypted),
    webhookSecretMasked: maskedSecret(row.webhook_secret_encrypted),
    apiBaseUrl: row.api_base_url,
    apiVersion: row.api_version,
    webhookAuthHeader: row.webhook_auth_header,
    contractUrl: row.contract_url,
    contractVersion: row.contract_version,
    contractReviewedAt: row.contract_reviewed_at,
    credentialExpiresAt: row.credential_expires_at,
    config: row.config ?? {},
    lastTestStatus: row.last_test_status,
    lastTestedAt: row.last_tested_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
    activationReady: providerActivationReady(row.provider),
  };
}

export async function listDeliveryProviderSettings() {
  const result = await query<any>(
    `SELECT ${PROVIDER_SETTING_COLUMNS}
       FROM bms_delivery_provider_settings ORDER BY provider, environment`,
  );
  return result.rows.map(publicRow);
}

/**
 * Trusted adapter boundary. Never return this value from a route or pass it into client code.
 * A provider can consume platform credentials only after both the reviewed adapter contract and
 * the platform-owner activation gate are open.
 */
export async function loadActiveDeliveryProviderRuntimeConfig(
  providerInput: DeliveryProvider,
  environmentInput: DeliveryEnvironment,
) {
  const provider = providerOf(providerInput);
  const environment = environmentOf(environmentInput);
  if (!providerActivationReady(provider)) {
    throw new DeliveryProviderSettingError("DELIVERY_PROVIDER_ADAPTER_NOT_VERIFIED", 409);
  }
  const result = await query<any>(
    `SELECT ${PROVIDER_SETTING_COLUMNS}
       FROM bms_delivery_provider_settings
      WHERE provider = $1 AND environment = $2`,
    [provider, environment],
  );
  const row = result.rows[0];
  if (!row || row.onboarding_status !== "ACTIVE" || row.tenant_connections_enabled !== true) {
    throw new DeliveryProviderSettingError("DELIVERY_PROVIDER_NOT_ACTIVE", 409);
  }
  const decrypt = (stored: string | null) => {
    if (!stored) return null;
    const plain = decryptSecret(stored);
    if (!plain) throw new Error("DELIVERY_PROVIDER_SECRET_DECRYPT_FAILED");
    return plain;
  };
  return {
    provider,
    environment,
    credentialAuthority: row.credential_authority as CredentialAuthority,
    authenticationMode: row.authentication_mode as AuthenticationMode,
    partnerId: row.partner_id as string | null,
    clientId: row.client_id as string | null,
    clientSecret: decrypt(row.client_secret_encrypted),
    accessToken: decrypt(row.access_token_encrypted),
    refreshToken: decrypt(row.refresh_token_encrypted),
    webhookSecret: decrypt(row.webhook_secret_encrypted),
    apiBaseUrl: row.api_base_url as string | null,
    apiVersion: row.api_version as string | null,
    webhookAuthHeader: row.webhook_auth_header as string | null,
    config: row.config as Record<string, string | number | boolean>,
  };
}

export async function saveDeliveryProviderSetting(input: {
  actorUserId: string;
  provider: unknown;
  environment: unknown;
  onboardingStatus: unknown;
  credentialAuthority: unknown;
  authenticationMode: unknown;
  tenantConnectionsEnabled: boolean;
  partnerId?: unknown;
  clientId?: unknown;
  clientSecret?: unknown;
  accessToken?: unknown;
  refreshToken?: unknown;
  webhookSecret?: unknown;
  apiBaseUrl?: unknown;
  apiVersion?: unknown;
  webhookAuthHeader?: unknown;
  contractUrl?: unknown;
  contractVersion?: unknown;
  contractReviewedAt?: unknown;
  credentialExpiresAt?: unknown;
  config?: unknown;
}) {
  const provider = providerOf(input.provider);
  const environment = environmentOf(input.environment);
  const onboardingStatus = enumValue(input.onboardingStatus, STATUSES, "DELIVERY_ONBOARDING_STATUS_INVALID") as ProviderStatus;
  const credentialAuthority = enumValue(input.credentialAuthority, AUTHORITIES, "DELIVERY_CREDENTIAL_AUTHORITY_INVALID") as CredentialAuthority;
  const authenticationMode = enumValue(input.authenticationMode, AUTH_MODES, "DELIVERY_AUTHENTICATION_MODE_INVALID") as AuthenticationMode;
  const config = safeConfig(input.config);
  const apiBaseUrl = httpsUrl(input.apiBaseUrl, "DELIVERY_API_BASE_URL_INVALID");
  const contractUrl = httpsUrl(input.contractUrl, "DELIVERY_CONTRACT_URL_INVALID");
  const contractReviewedAt = instant(input.contractReviewedAt, "DELIVERY_CONTRACT_REVIEWED_AT_INVALID");
  const credentialExpiresAt = instant(input.credentialExpiresAt, "DELIVERY_CREDENTIAL_EXPIRY_INVALID");
  const activationRequested = onboardingStatus === "CERTIFIED" || onboardingStatus === "ACTIVE"
    || input.tenantConnectionsEnabled;
  if (activationRequested && !providerActivationReady(provider)) {
    throw new DeliveryProviderSettingError("DELIVERY_PROVIDER_ADAPTER_NOT_VERIFIED", 409);
  }
  if (input.tenantConnectionsEnabled && onboardingStatus !== "ACTIVE") {
    throw new DeliveryProviderSettingError("DELIVERY_PROVIDER_ACTIVE_REQUIRED", 409);
  }
  if (onboardingStatus !== "DRAFT" && !contractUrl) {
    throw new DeliveryProviderSettingError("DELIVERY_PROVIDER_CONTRACT_REQUIRED", 409);
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    const current = await client.query<any>(
      `SELECT ${PROVIDER_SETTING_COLUMNS} FROM bms_delivery_provider_settings
        WHERE provider = $1 AND environment = $2 FOR UPDATE`,
      [provider, environment],
    );
    const old = current.rows[0];
    const secret = (value: unknown, previous: string | null) => {
      const next = secretValue(value);
      return next ? encryptSecret(next) : previous;
    };
    const secrets = {
      clientSecret: secret(input.clientSecret, old?.client_secret_encrypted ?? null),
      accessToken: secret(input.accessToken, old?.access_token_encrypted ?? null),
      refreshToken: secret(input.refreshToken, old?.refresh_token_encrypted ?? null),
      webhookSecret: secret(input.webhookSecret, old?.webhook_secret_encrypted ?? null),
    };
    const saved = await client.query<any>(
      `INSERT INTO bms_delivery_provider_settings (
         provider, environment, onboarding_status, credential_authority, authentication_mode,
         tenant_connections_enabled, partner_id, client_id, client_secret_encrypted,
         access_token_encrypted, refresh_token_encrypted, webhook_secret_encrypted,
         api_base_url, api_version, webhook_auth_header, contract_url, contract_version,
         contract_reviewed_at, credential_expires_at, config, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$21)
       ON CONFLICT (provider, environment) DO UPDATE SET
         onboarding_status = EXCLUDED.onboarding_status,
         credential_authority = EXCLUDED.credential_authority,
         authentication_mode = EXCLUDED.authentication_mode,
         tenant_connections_enabled = EXCLUDED.tenant_connections_enabled,
         partner_id = EXCLUDED.partner_id, client_id = EXCLUDED.client_id,
         client_secret_encrypted = EXCLUDED.client_secret_encrypted,
         access_token_encrypted = EXCLUDED.access_token_encrypted,
         refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
         webhook_secret_encrypted = EXCLUDED.webhook_secret_encrypted,
         api_base_url = EXCLUDED.api_base_url, api_version = EXCLUDED.api_version,
         webhook_auth_header = EXCLUDED.webhook_auth_header,
         contract_url = EXCLUDED.contract_url, contract_version = EXCLUDED.contract_version,
         contract_reviewed_at = EXCLUDED.contract_reviewed_at,
         credential_expires_at = EXCLUDED.credential_expires_at,
         config = EXCLUDED.config, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING ${PROVIDER_SETTING_COLUMNS}`,
      [provider, environment, onboardingStatus, credentialAuthority, authenticationMode,
        input.tenantConnectionsEnabled, textValue(input.partnerId, 500), textValue(input.clientId, 500),
        secrets.clientSecret, secrets.accessToken, secrets.refreshToken, secrets.webhookSecret,
        apiBaseUrl, textValue(input.apiVersion, 100), textValue(input.webhookAuthHeader, 100),
        contractUrl, textValue(input.contractVersion, 200), contractReviewedAt, credentialExpiresAt,
        JSON.stringify(config), input.actorUserId],
    );
    const rotated = {
      clientSecret: Boolean(secretValue(input.clientSecret)),
      accessToken: Boolean(secretValue(input.accessToken)),
      refreshToken: Boolean(secretValue(input.refreshToken)),
      webhookSecret: Boolean(secretValue(input.webhookSecret)),
    };
    const action = !old ? "CREATED"
      : Object.values(rotated).some(Boolean) ? "CREDENTIAL_ROTATED"
        : old.onboarding_status !== onboardingStatus ? "STATUS_CHANGED" : "UPDATED";
    await client.query(
      `INSERT INTO bms_delivery_provider_setting_events
         (setting_id, actor_user_id, action, safe_meta)
       VALUES ($1,$2,$3,$4::jsonb)`,
      [saved.rows[0].id, input.actorUserId, action,
        JSON.stringify({ provider, environment, onboardingStatus, credentialAuthority,
          authenticationMode, tenantConnectionsEnabled: input.tenantConnectionsEnabled, rotated })],
    );
    await client.query("COMMIT");
    return publicRow(saved.rows[0]);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
