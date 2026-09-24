import { createHash, randomUUID } from "node:crypto";

import { sharedRedisClient } from "@/lib/cache";
import { decryptSecret, encryptSecret } from "../crypto";
import { providerHttpFailure, runDeliveryCall } from "./safeCall";
import type { AdapterResult, DeliveryAdapterConfig } from "./types";

type RedisTokenStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  del(key: string): Promise<unknown>;
  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
};

export type FoodpandaAuthDependencies = {
  redis?: RedisTokenStore;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

type FoodpandaToken = {
  accessToken: string;
  cache: "HIT" | "MISS" | "LEGACY";
};

// Longer than runDeliveryCall's 10s provider timeout so a slow token exchange
// cannot outlive its fleet lock and start a second concurrent refresh.
const TOKEN_LOCK_MS = 15_000;
const TOKEN_WAIT_STEPS = 20;
const TOKEN_WAIT_MS = 50;

function tokenBaseUrl(config: DeliveryAdapterConfig): string {
  return config.environment === "LIVE"
    ? "https://foodpanda.partner.deliveryhero.io"
    : "https://sandbox.partner.deliveryhero.io";
}

function tokenNamespace(config: DeliveryAdapterConfig): string {
  const identity = config.integrationId
    ?? createHash("sha256").update(config.clientId ?? "missing-client").digest("hex").slice(0, 24);
  return `delivery:foodpanda:oauth:${config.environment.toLowerCase()}:${identity}`;
}

export function foodpandaTokenTtlSeconds(expiresIn: unknown): number | null {
  const seconds = Number(expiresIn);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const whole = Math.floor(seconds);
  const margin = Math.min(60, Math.max(5, Math.floor(whole * 0.1)));
  return Math.max(1, whole - margin);
}

async function cachedToken(
  redis: RedisTokenStore,
  key: string,
  now: number,
): Promise<string | null> {
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { token: string; expiresAt: number };
    if (!parsed.token?.startsWith("enc:") || !Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= now) return null;
    return decryptSecret(parsed.token);
  } catch {
    return null;
  }
}

async function requestToken(
  config: DeliveryAdapterConfig,
  fetchImpl: typeof fetch,
): Promise<AdapterResult<{ accessToken: string; ttlSeconds: number }>> {
  if (!config.clientId || !config.clientSecret) {
    return { ok: false, code: "UNCONFIGURED", retryable: false, detail: "foodpanda OAuth client credentials are missing", providerAttempts: 0 };
  }
  const result = await runDeliveryCall(async (signal) => {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId!,
      client_secret: config.clientSecret!,
    });
    const response = await fetchImpl(`${tokenBaseUrl(config)}/v2/oauth/token`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal,
    });
    if (!response.ok) return { ...providerHttpFailure(response.status), providerAttempts: 1 };
    try {
      const payload = await response.json() as Record<string, unknown>;
      const accessToken = typeof payload.access_token === "string" && payload.access_token.trim()
        ? payload.access_token.trim() : null;
      const tokenType = typeof payload.token_type === "string" ? payload.token_type.toLowerCase() : "bearer";
      const ttlSeconds = foodpandaTokenTtlSeconds(payload.expires_in);
      if (!accessToken || tokenType !== "bearer" || ttlSeconds === null) {
        return {
          ok: false as const,
          code: "INVALID_RESPONSE" as const,
          retryable: false,
          detail: "foodpanda OAuth response is invalid",
          providerAttempts: 1,
        };
      }
      return {
        ok: true as const,
        value: { accessToken, ttlSeconds },
        source: config.environment === "LIVE" ? "live" as const : "sandbox" as const,
        providerAttempts: 1,
      };
    } catch {
      return {
        ok: false as const,
        code: "INVALID_RESPONSE" as const,
        retryable: false,
        detail: "foodpanda OAuth returned malformed JSON",
        providerAttempts: 1,
      };
    }
  });
  return { ...result, providerAttempts: result.providerAttempts ?? 1 };
}

export async function invalidateFoodpandaToken(
  config: DeliveryAdapterConfig,
  dependencies: FoodpandaAuthDependencies = {},
): Promise<void> {
  if (!config.clientId || !config.clientSecret) return;
  try {
    const redis = (dependencies.redis ?? sharedRedisClient) as unknown as RedisTokenStore;
    await redis.del(`${tokenNamespace(config)}:token`);
  } catch {
    // Cache invalidation is best-effort. The next 401 remains fail-closed and
    // workers retry through their durable row; no credential is logged here.
  }
}

export async function getFoodpandaAccessToken(
  config: DeliveryAdapterConfig,
  options: FoodpandaAuthDependencies & { forceRefresh?: boolean } = {},
): Promise<AdapterResult<FoodpandaToken>> {
  // Backward compatibility only: existing encrypted static access tokens keep
  // working until the integration is rotated to client credentials. OAuth is
  // always preferred and fetched tokens are never written back to PostgreSQL.
  if (!config.clientId || !config.clientSecret) {
    return config.accessToken
      ? { ok: true, value: { accessToken: config.accessToken, cache: "LEGACY" }, source: config.environment === "LIVE" ? "live" : "sandbox", providerAttempts: 0 }
      : { ok: false, code: "UNCONFIGURED", retryable: false, detail: "foodpanda OAuth client credentials are missing", providerAttempts: 0 };
  }

  const redis = (options.redis ?? sharedRedisClient) as unknown as RedisTokenStore;
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const base = tokenNamespace(config);
  const tokenKey = `${base}:token`;
  const lockKey = `${base}:lock`;
  if (options.forceRefresh) {
    try { await redis.del(tokenKey); } catch {}
  } else {
    try {
      const hit = await cachedToken(redis, tokenKey, now());
      if (hit) return { ok: true, value: { accessToken: hit, cache: "HIT" }, source: config.environment === "LIVE" ? "live" : "sandbox", providerAttempts: 0 };
    } catch {
      // Redis is a cache, not an authentication bypass. Fetch a fresh token
      // below; no module-local token becomes fleet authority.
    }
  }

  const owner = randomUUID();
  let locked = false;
  try {
    locked = (await redis.set(lockKey, owner, "PX", TOKEN_LOCK_MS, "NX")) === "OK";
  } catch {
    // A Redis outage degrades to a direct token request. Authentication still
    // fails closed; only fleet-wide stampede protection is temporarily absent.
    const direct = await requestToken(config, fetchImpl);
    return direct.ok
      ? { ok: true, value: { accessToken: direct.value.accessToken, cache: "MISS" }, source: direct.source, providerAttempts: direct.providerAttempts }
      : direct;
  }

  if (!locked) {
    for (let step = 0; step < TOKEN_WAIT_STEPS; step += 1) {
      await sleep(TOKEN_WAIT_MS);
      try {
        const hit = await cachedToken(redis, tokenKey, now());
        if (hit) return { ok: true, value: { accessToken: hit, cache: "HIT" }, source: config.environment === "LIVE" ? "live" : "sandbox", providerAttempts: 0 };
      } catch {
        break;
      }
    }
    return {
      ok: false,
      code: "PROVIDER_ERROR",
      retryable: true,
      detail: "foodpanda OAuth refresh is already in progress",
      providerAttempts: 0,
    };
  }

  let providerAttempts = 0;
  try {
    if (!options.forceRefresh) {
      const raced = await cachedToken(redis, tokenKey, now());
      if (raced) return { ok: true, value: { accessToken: raced, cache: "HIT" }, source: config.environment === "LIVE" ? "live" : "sandbox", providerAttempts: 0 };
    }
    const requested = await requestToken(config, fetchImpl);
    providerAttempts = requested.providerAttempts ?? 0;
    if (!requested.ok) return requested;
    const encrypted = encryptSecret(requested.value.accessToken);
    if (!encrypted) {
      return { ok: false, code: "INVALID_RESPONSE", retryable: false, detail: "foodpanda OAuth token could not be protected", providerAttempts: requested.providerAttempts };
    }
    const expiresAt = now() + requested.value.ttlSeconds * 1_000;
    try {
      await redis.set(tokenKey, JSON.stringify({ token: encrypted, expiresAt }), "EX", requested.value.ttlSeconds);
    } catch {
      // The credential exchange succeeded. Use this short-lived token for the
      // current call even if the fleet cache is temporarily unavailable.
    }
    return {
      ok: true,
      value: { accessToken: requested.value.accessToken, cache: "MISS" },
      source: requested.source,
      providerAttempts: requested.providerAttempts,
    };
  } catch {
    return { ok: false, code: "PROVIDER_ERROR", retryable: true, detail: "foodpanda OAuth cache operation failed", providerAttempts };
  } finally {
    try {
      await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        owner,
      );
    } catch {}
  }
}
