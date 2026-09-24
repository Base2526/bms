import assert from "node:assert/strict";
import test from "node:test";

import {
  foodpandaTokenTtlSeconds,
  getFoodpandaAccessToken,
} from "../apps/web/lib/bms/deliveryPlatforms/foodpandaAuth.ts";
import {
  canonicalFoodpandaPayloadHash,
  foodpandaAdapter,
  foodpandaJson,
  normalizeFoodpandaOrder,
  normalizeFoodpandaTransportType,
} from "../apps/web/lib/bms/deliveryPlatforms/foodpanda.ts";
import { runDeliveryCall } from "../apps/web/lib/bms/deliveryPlatforms/safeCall.ts";
import { foodpandaCommandForLocalTransition } from "../apps/web/lib/bms/deliveryPlatforms/transportLifecycle.ts";
import type { DeliveryAdapterConfig } from "../apps/web/lib/bms/deliveryPlatforms/types.ts";

class FakeRedis {
  readonly values = new Map<string, string>();

  async get(key: string) { return this.values.get(key) ?? null; }

  async set(key: string, value: string, ...args: Array<string | number>) {
    if (args.includes("NX") && this.values.has(key)) return null;
    this.values.set(key, value);
    return "OK";
  }

  async del(key: string) { return this.values.delete(key) ? 1 : 0; }

  async eval(_script: string, _numberOfKeys: number, key: string, owner: string) {
    if (this.values.get(key) !== owner) return 0;
    this.values.delete(key);
    return 1;
  }
}

const config: DeliveryAdapterConfig = {
  integrationId: "integration-1",
  environment: "SANDBOX",
  clientId: "client-id",
  clientSecret: "client-secret",
  accessToken: null,
  refreshToken: null,
  webhookSecret: "webhook-secret",
  apiVersion: "v2",
  config: { chainId: "chain-1", currency: "THB", webhookAuthHeader: "x-webhook-secret" },
};

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("foodpanda OAuth TTL keeps a bounded safety margin", () => {
  assert.equal(foodpandaTokenTtlSeconds(7200), 7140);
  assert.equal(foodpandaTokenTtlSeconds(100), 90);
  assert.equal(foodpandaTokenTtlSeconds(10), 5);
  assert.equal(foodpandaTokenTtlSeconds(0), null);
});

test("foodpanda OAuth uses client credentials, encrypted fleet cache, and cache hits", async () => {
  const redis = new FakeRedis();
  let fetches = 0;
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    fetches += 1;
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("content-type"), "application/x-www-form-urlencoded");
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("grant_type"), "client_credentials");
    assert.equal(body.get("client_id"), config.clientId);
    assert.equal(body.get("client_secret"), config.clientSecret);
    return jsonResponse({ access_token: "short-lived-token", token_type: "Bearer", expires_in: 7200 });
  };
  const first = await getFoodpandaAccessToken(config, { redis, fetch: fetchImpl as typeof fetch, now: () => 1_000 });
  const second = await getFoodpandaAccessToken(config, { redis, fetch: fetchImpl as typeof fetch, now: () => 2_000 });
  assert.equal(first.ok && first.value.cache, "MISS");
  assert.equal(second.ok && second.value.cache, "HIT");
  assert.equal(fetches, 1);
  const durableCache = [...redis.values.values()].join("\n");
  assert.doesNotMatch(durableCache, /short-lived-token|client-secret/);
  assert.match(durableCache, /enc:/);
});

test("concurrent OAuth refreshes collapse to one provider token request", async () => {
  const redis = new FakeRedis();
  let fetches = 0;
  const fetchImpl = async () => {
    fetches += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return jsonResponse({ access_token: "one-token", token_type: "Bearer", expires_in: 7200 });
  };
  const results = await Promise.all(Array.from({ length: 8 }, () => getFoodpandaAccessToken(config, {
    redis,
    fetch: fetchImpl as typeof fetch,
    now: () => 1_000,
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, Math.min(milliseconds, 2))),
  })));
  assert.equal(fetches, 1);
  assert.equal(results.every((result) => result.ok && result.value.accessToken === "one-token"), true);
});

test("a 401 invalidates OAuth cache and retries the same provider call once", async () => {
  const redis = new FakeRedis();
  let tokenCalls = 0;
  let orderCalls = 0;
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/v2/oauth/token")) {
      tokenCalls += 1;
      return jsonResponse({ access_token: `token-${tokenCalls}`, token_type: "Bearer", expires_in: 7200 });
    }
    orderCalls += 1;
    const authorization = new Headers(init?.headers).get("authorization");
    if (authorization === "Bearer token-1") return jsonResponse({ error: "expired" }, 401);
    assert.equal(authorization, "Bearer token-2");
    return jsonResponse({ ok: true });
  };
  const result = await foodpandaJson(config, "/v2/chains/chain-1/orders/order-1", {}, {
    redis,
    fetch: fetchImpl as typeof fetch,
    now: () => 1_000,
  });
  assert.equal(result.ok, true);
  assert.equal(tokenCalls, 2);
  assert.equal(orderCalls, 2);
  assert.equal(result.providerAttempts, 4);
});

test("logical webhook identity is separate from canonical payload conflict hash", () => {
  const base = {
    order_id: "order-1",
    order_code: "A-1",
    status: "RECEIVED",
    order_type: "DELIVERY",
    transport_type: "LOGISTICS_DELIVERY",
    client: { store_id: "store-1" },
    sys: { updated_at: "2026-09-24T10:00:00Z" },
  };
  const headers = new Headers({ "x-webhook-secret": "webhook-secret" });
  const first = foodpandaAdapter.verifyWebhook({ rawBody: JSON.stringify(base), headers, config });
  const reordered = { sys: base.sys, client: base.client, transport_type: base.transport_type,
    order_type: base.order_type, status: base.status, order_code: base.order_code, order_id: base.order_id };
  const second = foodpandaAdapter.verifyWebhook({ rawBody: JSON.stringify(reordered, null, 2), headers, config });
  const changed = foodpandaAdapter.verifyWebhook({ rawBody: JSON.stringify({ ...base, order_code: "A-2" }), headers, config });
  assert.equal(first.ok && second.ok && changed.ok, true);
  if (first.ok && second.ok && changed.ok) {
    assert.equal(first.value.externalEventId, second.value.externalEventId);
    assert.equal(first.value.payloadHash, second.value.payloadHash);
    assert.equal(first.value.externalEventId, changed.value.externalEventId);
    assert.notEqual(first.value.payloadHash, changed.value.payloadHash);
  }
  assert.equal(canonicalFoodpandaPayloadHash({ b: 2, a: 1 }), canonicalFoodpandaPayloadHash({ a: 1, b: 2 }));
});

test("transport type is typed and order normalization refuses unknown values", () => {
  assert.equal(normalizeFoodpandaTransportType("logistics_delivery"), "LOGISTICS_DELIVERY");
  assert.equal(normalizeFoodpandaTransportType("merchant_guess"), null);
  const normalized = normalizeFoodpandaOrder({
    order_id: "order-1", status: "RECEIVED", order_type: "DELIVERY", transport_type: "unknown",
    client: { store_id: "store-1" }, payment: { sub_total: 100, order_total: 100 },
    items: [{ _id: "line-1", sku: "sku-1", name: "Meal", pricing: { quantity: 1, unit_price: 100 } }],
    sys: { updated_at: "2026-09-24T10:00:00Z" }, currency: "THB",
  }, config);
  assert.equal(normalized.ok, false);
  if (!normalized.ok) assert.equal(normalized.code, "INVALID_TRANSPORT_TYPE");
});

test("foodpanda local lifecycle selects only the transport-authorized command", () => {
  assert.deepEqual(foodpandaCommandForLocalTransition("LOGISTICS_DELIVERY", "READY"),
    { ok: true, commandType: "MARK_READY" });
  assert.deepEqual(foodpandaCommandForLocalTransition("LOGISTICS_DELIVERY", "HANDED_OVER"),
    { ok: true, commandType: null });
  assert.deepEqual(foodpandaCommandForLocalTransition("VENDOR_DELIVERY", "READY"),
    { ok: true, commandType: null });
  assert.deepEqual(foodpandaCommandForLocalTransition("VENDOR_DELIVERY", "HANDED_OVER"),
    { ok: true, commandType: "MARK_DISPATCHED" });
  assert.deepEqual(foodpandaCommandForLocalTransition(null, "READY"),
    { ok: false, code: "INVALID_TRANSPORT_TYPE" });
});

test("provider runtime errors cannot copy a credential into durable detail", async () => {
  const result = await runDeliveryCall(async () => {
    throw new Error("Bearer secret-token client-secret");
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.detail, "Provider request failed");
    assert.doesNotMatch(result.detail, /secret-token|client-secret/);
  }
});
