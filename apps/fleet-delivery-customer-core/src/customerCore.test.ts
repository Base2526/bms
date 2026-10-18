import assert from "node:assert/strict";
import test from "node:test";
import { CustomerDeliveryClient, CustomerDeliveryFlow } from "./index.js";

const requirement = {
  serviceType: "ON_DEMAND" as const,
  requiredVehicleType: "MOTORCYCLE" as const,
  requiredCapacityKg: 20,
  packageWeightKg: 12.5,
  packageSizeClass: "SMALL" as const,
  specialHandling: [],
  requirementVersion: "customer-mobile:v1",
};

const quote = {
  quoteId: "11111111-1111-4111-8111-111111111111",
  currency: "THB" as const,
  billableDistanceMeters: 1001,
  startedKilometres: 2,
  baseFareSatang: 1500,
  distanceChargeSatang: 1400,
  grossDeliveryFeeSatang: 2900,
  customerContributionSatang: 2400,
  merchantSubsidySatang: 500,
  explicitDiscountSatang: 0,
  eligibleCommissionFeeSatang: 2900,
  commissionSatang: 145,
  commissionBps: 500,
  pricingRuleVersion: "synthetic:v1",
  eligibilityVersion: "synthetic:v1",
  serviceRequirement: requirement,
  expiresAt: "2099-01-01T00:00:00.000Z",
};

test("customer client sends only requirement or quote authority and never tenant/order refs", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), ...(init ? { init } : {}) });
    const body = requests.length === 1
      ? quote
      : {
          deliveryId: "22222222-2222-4222-8222-222222222222",
          state: "AWAITING_PAYMENT",
          version: 1,
          quoteId: quote.quoteId,
          serviceRequirement: requirement,
        };
    return new Response(JSON.stringify(body), {
      status: requests.length === 1 ? 201 : 201,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const client = new CustomerDeliveryClient({
    apiBaseUrl: "http://127.0.0.1:4100",
    accessToken: "a".repeat(43),
    expiresAt: "2099-01-01T00:00:00.000Z",
    syntheticOnly: true,
  }, fakeFetch);
  const flow = new CustomerDeliveryFlow(client);
  assert.equal((await flow.requestQuote(requirement)).status, "QUOTED");
  assert.equal((await flow.confirmDelivery()).status, "DELIVERY_CREATED");
  assert.equal(requests[0]?.url, "http://127.0.0.1:4100/v1/customer/quotes");
  assert.equal(requests[1]?.url, "http://127.0.0.1:4100/v1/customer/deliveries");
  const payloads = requests.map((request) => JSON.parse(String(request.init?.body)) as Record<string, unknown>);
  assert.equal(payloads.some((body) => "tenantRef" in body || "branchRef" in body || "bmsOrderRef" in body), false);
  assert.equal((requests[0]?.init?.headers as Record<string, string>).authorization, `Bearer ${"a".repeat(43)}`);
});

test("customer status read sends no caller scope and rejects privacy-expanding fields", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const validStatus = {
    serverNow: "2099-01-01T00:00:00.000Z",
    delivery: {
      deliveryId: "22222222-2222-4222-8222-222222222222",
      quoteId: quote.quoteId,
      state: "SEARCHING_DRIVER",
      version: 5,
      matchStage: "SEARCHING",
      currency: "THB",
      grossDeliveryFeeSatang: 2900,
      customerContributionSatang: 2400,
      merchantSubsidySatang: 500,
      updatedAt: "2099-01-01T00:00:00.000Z",
    },
  };
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), ...(init ? { init } : {}) });
    return new Response(JSON.stringify(validStatus), { status: 200 });
  }) as typeof fetch;
  const client = new CustomerDeliveryClient({
    apiBaseUrl: "http://127.0.0.1:4100",
    accessToken: "a".repeat(43),
    expiresAt: "2099-01-01T00:00:00.000Z",
    syntheticOnly: true,
  }, fakeFetch);
  assert.equal((await client.getDeliveryStatus()).delivery?.matchStage, "SEARCHING");
  assert.equal(requests[0]?.url, "http://127.0.0.1:4100/v1/customer/deliveries/current");
  assert.equal(requests[0]?.init?.method, "GET");
  assert.equal(requests[0]?.init?.body, undefined);

  const unsafeClient = new CustomerDeliveryClient({
    apiBaseUrl: "http://127.0.0.1:4100",
    accessToken: "a".repeat(43),
    expiresAt: "2099-01-01T00:00:00.000Z",
    syntheticOnly: true,
  }, (async () => new Response(JSON.stringify({
    ...validStatus,
    delivery: { ...validStatus.delivery, driverPhone: "0800000000" },
  }), { status: 200 })) as typeof fetch);
  await assert.rejects(() => unsafeClient.getDeliveryStatus());
});

test("customer client rejects production HTTP, expired sessions and confirmation without quote", async () => {
  assert.throws(() => new CustomerDeliveryClient({
    apiBaseUrl: "http://example.com",
    accessToken: "a".repeat(43),
    expiresAt: "2099-01-01T00:00:00.000Z",
    syntheticOnly: true,
  }));
  const expired = new CustomerDeliveryClient({
    apiBaseUrl: "http://127.0.0.1:4100",
    accessToken: "a".repeat(43),
    expiresAt: "2020-01-01T00:00:00.000Z",
    syntheticOnly: true,
  });
  await assert.rejects(() => expired.quote(requirement), /CUSTOMER_SESSION_EXPIRED/);
  await assert.rejects(
    () => new CustomerDeliveryFlow(expired).confirmDelivery(),
    /QUOTE_REQUIRED/,
  );
});

test("delivery retry after a lost reply or restart keeps the same idempotency key and origin", async () => {
  const requests: Array<{ url: string; key: string }> = [];
  const activation = {
    apiBaseUrl: "http://127.0.0.1:4100/",
    accessToken: "a".repeat(43),
    expiresAt: "2099-01-01T00:00:00.000Z",
    syntheticOnly: true as const,
  };
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), key: (init?.headers as Record<string, string>)["idempotency-key"]! });
    if (requests.length === 1) throw new Error("CONNECTION_LOST_AFTER_COMMIT");
    return new Response(JSON.stringify({
      deliveryId: "22222222-2222-4222-8222-222222222222",
      state: "AWAITING_PAYMENT", version: 1, quoteId: quote.quoteId, serviceRequirement: requirement,
    }), { status: 201 });
  }) as typeof fetch;
  await assert.rejects(
    () => new CustomerDeliveryClient(activation, fakeFetch).createDelivery(quote.quoteId),
    /CONNECTION_LOST_AFTER_COMMIT/,
  );
  await new CustomerDeliveryClient(activation, fakeFetch).createDelivery(quote.quoteId);
  assert.equal(requests[0]?.key, requests[1]?.key);
  assert.equal(requests[1]?.url, "http://127.0.0.1:4100/v1/customer/deliveries");
});

test("unresponsive customer requests time out and remain retryable", async () => {
  const keys: string[] = [];
  const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    keys.push((init?.headers as Record<string, string>)["idempotency-key"]!);
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("ABORTED")), { once: true });
    });
  }) as typeof fetch;
  const client = new CustomerDeliveryClient({
    apiBaseUrl: "http://127.0.0.1:4100", accessToken: "a".repeat(43),
    expiresAt: "2099-01-01T00:00:00.000Z", syntheticOnly: true,
  }, fakeFetch, 5);
  await assert.rejects(() => client.createDelivery(quote.quoteId), /CUSTOMER_REQUEST_TIMEOUT/);
  await assert.rejects(() => client.createDelivery(quote.quoteId), /CUSTOMER_REQUEST_TIMEOUT/);
  assert.equal(keys[0], keys[1]);
});
