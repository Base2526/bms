import assert from "node:assert/strict";
import test from "node:test";
import { readBoundedBodyBytes, readBoundedWebhookText } from "../apps/web/lib/bms/webhookBody.ts";
import { loadWithStubs } from "./testing/webhookHarness.mts";

function chunked(chunks: Uint8Array[], headers = new Headers()) {
  let reads = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk) { reads++; controller.enqueue(chunk); }
      else controller.close();
    },
  }, { highWaterMark: 0 });
  return { source: { headers, body }, get reads() { return reads; } };
}

test("webhook text accepts the exact byte limit and preserves signed bytes", async () => {
  const payload = new TextEncoder().encode("ปลา 🐟");
  const source = chunked([payload.subarray(0, 4), payload.subarray(4)]);
  assert.deepEqual(await readBoundedWebhookText(source.source, payload.byteLength),
    { ok: true, text: "ปลา 🐟" });
});

test("declared and streaming body limits reject before buffering the full payload", async () => {
  const declared = chunked([new Uint8Array(10)], new Headers({ "content-length": "10" }));
  assert.deepEqual(await readBoundedWebhookText(declared.source, 8),
    { ok: false, status: 413, error: "payload too large" });
  assert.equal(declared.reads, 0);

  const streaming = chunked([new Uint8Array(5), new Uint8Array(5), new Uint8Array(5)]);
  assert.deepEqual(await readBoundedBodyBytes(streaming.source, 8),
    { ok: false, status: 413, error: "payload too large" });
  assert.ok(streaming.reads <= 2, "stop once the limit is crossed");
});

test("invalid UTF-8 is rejected before signature or JSON processing", async () => {
  const source = chunked([Uint8Array.of(0xc3, 0x28)]);
  assert.deepEqual(await readBoundedWebhookText(source.source, 8),
    { ok: false, status: 400, error: "invalid utf-8 payload" });
});

test("delivery webhook route rejects oversized and invalid text before provider intake", async () => {
  let intakes = 0;
  const route = loadWithStubs("apps/web/app/api/bms/delivery/[provider]/webhook/[integrationId]/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, options?: { status: number }) =>
      ({ body, status: options?.status ?? 200 }) } },
    "@/lib/bms/rateLimit": { rateLimit: async () => ({ ok: true }) },
    "@/lib/bms/deliveryPlatforms/webhooks": { intakeDeliveryWebhook: async () => {
      intakes++; return { status: "ACCEPTED", duplicate: false };
    } },
    "@/lib/bms/webhookBody": { readBoundedWebhookText },
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
  });
  const params = { params: { provider: "foodpanda", integrationId: "00000000-0000-4000-8000-000000000001" } };
  const post = (body: BodyInit) => route.POST(new Request("https://example.test/webhook", {
    method: "POST", body,
  }), params);
  assert.equal((await post(" ".repeat(256 * 1024 + 1))).status, 413);
  assert.equal((await post(Uint8Array.of(0xc3, 0x28))).status, 400);
  assert.equal(intakes, 0);
  assert.equal((await post("{}")).status, 202);
  assert.equal(intakes, 1);
});

test("Retail Local evidence route bounds the body before processing the signed evidence", async () => {
  let ingestions = 0;
  const route = loadWithStubs("apps/web/app/api/bms/retail-local/license-evidence/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, options?: { status: number }) =>
      ({ body, status: options?.status ?? 200 }) } },
    "node:crypto": { default: await import("node:crypto") },
    "@/lib/bms/rateLimit": { rateLimit: async () => ({ ok: true }) },
    "@/lib/bms/retailLocalLicensing": { ingestRetailLocalLicenseEvidence: async () => {
      ingestions++; return { duplicate: false };
    }, RetailLocalLicenseError: class extends Error {} },
    "@/lib/bms/webhookBody": { readBoundedWebhookText },
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
  });
  const post = (body: BodyInit) => route.POST(new Request("https://example.test/license-evidence", {
    method: "POST", body, headers: {
      authorization: `Bearer ${"A".repeat(32)}`,
      "content-type": "application/json",
    },
  }));
  assert.equal((await post(" ".repeat(64 * 1024 + 1))).status, 413);
  assert.equal((await post(Uint8Array.of(0xc3, 0x28))).status, 400);
  assert.equal(ingestions, 0);
  assert.equal((await post("{}")).status, 202);
  assert.equal(ingestions, 1);
});

test("legacy development webhooks rate-limit before reading and reject oversized bodies", async () => {
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    for (const channel of ["line", "tiktok"] as const) {
      let allowed = false;
      let reads = 0;
      let writes = 0;
      const route = loadWithStubs(`apps/web/app/api/bms/${channel}/webhook/route.ts`, {
        "next/server": { NextResponse: { json: (body: unknown, options?: { status: number }) =>
          ({ body, status: options?.status ?? 200 }) } },
        "@/lib/bms/tenant": { DEFAULT_TENANT_ID: "00000000-0000-4000-8000-000000000001" },
        "@/lib/bms/rateLimit": { rateLimit: async () =>
          ({ ok: allowed, retryAfter: 60 }) },
        "@/lib/bms/webhookBody": { readBoundedWebhookText: async (...args: Parameters<typeof readBoundedWebhookText>) => {
          reads++;
          return readBoundedWebhookText(...args);
        } },
        "@/lib/bms/inboundEvents": {
          claimInboundEvent: async () => { writes++; return true; },
          releaseUnprocessedInboundEvent: async () => undefined,
        },
        "@/lib/bms/inbox": {
          logInboundMessage: async () => { writes++; return { id: "test" }; },
          logConversation: async () => { writes++; },
        },
        "@/lib/bms/pipeline": { runPipeline: async () => {
          writes++; return { reply: "test", quality: "test" };
        } },
        "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
      });
      const post = (body: BodyInit) => route.POST(new Request("http://localhost/mock", {
        method: "POST", body,
      }));

      assert.equal((await post("{}")).status, 429, `${channel}: denied before body read`);
      assert.equal(reads, 0, `${channel}: no body read when rate-limited`);
      assert.equal(writes, 0, `${channel}: no service call when rate-limited`);

      allowed = true;
      assert.equal((await post(" ".repeat(64 * 1024 + 1))).status, 413, `${channel}: oversized body`);
      assert.equal(writes, 0, `${channel}: no service call on oversized body`);
      assert.equal((await post(Uint8Array.of(0xc3, 0x28))).status, 400, `${channel}: invalid UTF-8`);
      assert.equal((await post("{")).status, 400, `${channel}: invalid JSON`);
      const key = channel === "line" ? "events" : "messages";
      assert.equal((await post(JSON.stringify({ [key]: Array.from({ length: 201 }, () => ({})) }))).status,
        400, `${channel}: event count bound`);
      assert.equal(writes, 0, `${channel}: no service call on invalid input`);
      const event = channel === "line"
        ? { type: "message", source: { userId: "FAKE-user" }, message: { id: "FAKE-id", type: "text", text: "hello" } }
        : { id: "FAKE-id", user_id: "FAKE-user", content: { text: "hello" } };
      assert.equal((await post(JSON.stringify({ [key]: [event] }))).status, 200, `${channel}: valid dev request`);
      assert.ok(writes > 0, `${channel}: valid request reaches its service`);
      const beforeProduction = writes;
      process.env.NODE_ENV = "production";
      assert.equal((await post("{}")).status, 404, `${channel}: disabled in production`);
      assert.equal(writes, beforeProduction, `${channel}: production must not reach service`);
      process.env.NODE_ENV = "development";
    }
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  }
});
