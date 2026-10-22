import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as crypto from "node:crypto";
import * as bodyReader from "../apps/web/lib/bms/retailLocalRequestBody.ts";
import { checkoutFixture } from "./testing/restaurantCheckoutHarness.mts";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
function load(file: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(`../apps/web/${file}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: any = {};
  new Function("require", "exports", compiled)((id: string) => {
    if (id in dependencies) return dependencies[id];
    throw new Error(`Unexpected dependency: ${id}`);
  }, exports);
  return exports;
}

function harness(options: { blocked?: "ip" | "token"; invalidToken?: boolean; checkout?: unknown } = {}) {
  const calls: string[] = [];
  const keys: string[] = [];
  const next = { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } };
  const helper = load("app/api/bms/checkout/routeHelpers.ts", {
    "node:crypto": crypto,
    "next/server": next,
    "@/lib/bms/rateLimit": {
      rateLimit: async (key: string, limit: number, window: number) => {
        keys.push(key);
        calls.push(`limit:${limit}:${window}`);
        return { ok: !options.blocked || !key.includes(`:${options.blocked}:`), retryAfter: 17 };
      },
    },
  });
  const checkout = {
    order: { id: "server-order", status: "PENDING", displayId: "TEST" },
    delivery: { complete: true, marketplaceManaged: false },
    payment: { latest: null, accounts: [{ method: "BANK_TRANSFER" }] },
  };
  const dependencies = {
    "next/server": next,
    "./routeHelpers": helper,
    "../routeHelpers": helper,
    "@/lib/bms/retailLocalRequestBody": bodyReader,
    "@/lib/bms/checkout": {
      getCheckoutByToken: async (token: string) => {
        calls.push(`read:${token}`);
        return options.invalidToken ? { ok: false, reason: "invalid" }
          : { ok: true, payload: { tenantId: "server-tenant" }, checkout: options.checkout ?? checkout };
      },
      saveCheckoutDeliveryByToken: async (token: string, input: Record<string, unknown>) => {
        calls.push("save");
        assert.equal(token, "signed-link");
        assert.equal(input.recipientName, "Test recipient");
        assert.equal(input.tenantId, undefined);
        assert.equal(input.orderId, undefined);
        return { ok: true, payload: { tenantId: "server-tenant" }, checkout };
      },
      submitCheckoutPaymentByToken: async () => { throw new Error("Unexpected payment write"); },
    },
    "@/lib/bms/audit": { audit: async (ctx: any) => {
      calls.push("audit");
      assert.equal(ctx.tenant_id, "server-tenant");
    } },
    "@/lib/log/routeError": { withRouteErrorLog: (_: string, fn: unknown) => fn },
    "@/lib/bms/payments": { PAYMENT_METHODS: ["BANK_TRANSFER", "QR"] },
    "@/lib/storage": { persistWebFile: async () => { throw new Error("Unexpected upload"); } },
    sharp: () => { throw new Error("Unexpected image decoding"); },
  };
  return {
    ...load("app/api/bms/checkout/route.ts", dependencies),
    ...load("app/api/bms/checkout/payment/route.ts", dependencies),
    calls, keys,
  };
}

const url = "http://localhost/api/bms/checkout?t=signed-link";
const request = (body: BodyInit, headers: Record<string, string> = {}) => new Request(url, {
  method: "PATCH", body, headers, duplex: "half",
} as RequestInit);

test("rate-limited payment route preserves service-derived pickup and delivery contact rules", async () => {
  for (const [type, missing, expected] of [
    ["PICKUP", ["shippingAddress"], "กรุณาแนบรูปสลิป"],
    ["PICKUP", ["phone", "shippingAddress"], "กรุณากรอกชื่อและเบอร์โทรผู้รับที่ยังขาดก่อน"],
    ["DELIVERY", ["shippingAddress"], "กรุณากรอกข้อมูลจัดส่งที่ยังขาดก่อน"],
  ] as const) {
    const fixture = checkoutFixture({ type, missing: [...missing] });
    const result = await fixture.service.getCheckoutByToken("signed-link");
    const h = harness({ checkout: result.checkout });
    const form = new FormData();
    form.set("token", "signed-link");
    form.set("method", "BANK_TRANSFER");
    const response = await h.POST(new Request(url, { method: "POST", body: form }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, expected);
    assert.deepEqual(h.calls, ["limit:10:60000", "limit:10:60000", "read:signed-link"]);
  }
});

test("all public checkout handlers reject over-limit sources before body parsing, DB or uploads", async () => {
  for (const method of ["GET", "PATCH", "POST"]) {
    const h = harness({ blocked: "ip" });
    const req = { url, headers: new Headers(), json() { assert.fail("body parsed"); }, formData() { assert.fail("upload parsed"); } };
    const response = await h[method](req);
    assert.equal(response.status, 429, method);
    assert.equal(response.headers.get("retry-after"), "17");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(h.calls.length, 1);
  }
});

test("token limits apply across IPs and do not retain raw bearer credentials in keys", async () => {
  const h = harness({ blocked: "token" });
  for (const ip of ["192.0.2.1", "192.0.2.2"]) {
    assert.equal((await h.GET(new Request(url, { headers: { "x-forwarded-for": ip } }))).status, 429);
  }
  assert.equal(h.keys[1], h.keys[3]);
  assert.notEqual(h.keys[0], h.keys[2]);
  assert.ok(h.keys.every((key: string) => !key.includes("signed-link") && !key.includes("192.0.2")));
  assert.equal(h.calls.filter((call: string) => call.startsWith("read:")).length, 0);
});

test("per-token denial prevents delivery writes and slip processing", async () => {
  const h = harness({ blocked: "token" });
  assert.equal((await h.PATCH(request(JSON.stringify({ token: "signed-link", recipientName: "Test recipient" })))).status, 429);
  const form = new FormData();
  form.set("token", "signed-link");
  form.set("method", "BANK_TRANSFER");
  assert.equal((await h.POST(new Request(url, { method: "POST", body: form }))).status, 429);
  assert.ok(h.calls.every((call: string) => call.startsWith("limit:")));
});

test("checkout GET preserves successful reads and rejects invalid links without caching", async () => {
  for (const invalidToken of [false, true]) {
    const h = harness({ invalidToken });
    const response = await h.GET(new Request(url));
    assert.equal(response.status, invalidToken ? 404 : 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(h.calls, ["limit:120:60000", "limit:120:60000", "read:signed-link"]);
  }
});

test("delivery rejects malformed JSON and non-object bodies without reading or writing customer data", async () => {
  for (const body of ["null", "[]", "123", '"text"', "{broken", "{}"] ) {
    const h = harness();
    assert.equal((await h.PATCH(request(body))).status, 400, body);
    assert.deepEqual(h.calls, ["limit:30:60000"]);
  }
});

test("delivery bounds actual streamed bytes even with absent or false content-length", async () => {
  for (const headers of [{}, { "content-length": "2" }]) {
    const h = harness();
    let cancelled = false;
    const stream = new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(4096)); },
      cancel() { cancelled = true; },
    });
    assert.equal((await h.PATCH(request(stream, headers))).status, 413);
    assert.equal(cancelled, true);
    assert.deepEqual(h.calls, ["limit:30:60000"]);
  }
});

test("valid delivery updates keep token-derived authority and audit the resolved tenant", async () => {
  const h = harness();
  const response = await h.PATCH(request(JSON.stringify({
    token: "signed-link", recipientName: "Test recipient", tenantId: "attacker", orderId: "attacker",
  })));
  assert.equal(response.status, 200);
  assert.deepEqual(h.calls, ["limit:30:60000", "limit:30:60000", "save", "audit"]);
});

test("payment validates the signed link before image decoding or persistence", async () => {
  const h = harness({ invalidToken: true });
  const form = new FormData();
  form.set("token", "invalid-link");
  form.set("method", "BANK_TRANSFER");
  const response = await h.POST(new Request(url, { method: "POST", body: form }));
  assert.equal(response.status, 404);
  assert.deepEqual(h.calls, ["limit:10:60000", "limit:10:60000", "read:invalid-link"]);
});

test("payment state changes after the checkout read are business failures, never successful submissions", async () => {
  const checkout = load("lib/bms/checkout.ts", {
    "@/lib/db": { query: async (sql: string) => ({ rows: sql.includes("FROM bms_orders o")
      ? [{ id: "order", channel: "web", customer_ref: "customer", status: "PENDING", created_at: "2026-10-22" }] : [] }) },
    "./customers": { getCustomerCheckoutStatus: async () => ({ missingFields: [] }) },
    "./documents": { generateInvoice: async () => ({ store: {}, lines: [] }) },
    "./orders": {},
    "./paymentConfiguration": { configuredPaymentAccounts: () => [], supportsCustomerPaymentMethod: () => true },
    "./payments": { submitPaymentOnce: async (input: any) => {
      assert.equal(input.amount, null);
      assert.equal(input.tenantId, "signed-tenant");
      return { status: "INVALID_ORDER_STATE", current: "CANCELLED" };
    } },
    "./storeProfile": { getStoreProfile: async () => ({ paymentAccounts: [] }) },
    "./checkoutToken": { verifyCheckoutToken: () => ({ tenantId: "signed-tenant", orderId: "order" }) },
  });
  const result = await checkout.submitCheckoutPaymentByToken("signed-link", { method: "BANK_TRANSFER", slipUrl: "/private-slip" });
  assert.equal(result.ok, false);
});
