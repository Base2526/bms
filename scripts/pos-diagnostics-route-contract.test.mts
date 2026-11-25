import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

const tenantId = randomUUID();
const deviceId = randomUUID();
const locationId = randomUUID();

function harness(options: { authenticated?: boolean; allowed?: boolean; body?: unknown;
  boundedError?: { status: number; error: string }; writerFails?: boolean; updatedAt?: string } = {}) {
  const ingested: any[] = [];
  const route = loadWithStubs("apps/web/app/api/pos/diagnostics/events/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, init?: { status?: number; headers?: unknown }) =>
      ({ body, status: init?.status ?? 200, headers: init?.headers }) } },
    "@/lib/bms/pos": { authenticatePosDevice: async (token: string) => options.authenticated === false || token !== "valid-token"
      ? null : { tenantId, id: deviceId, locationId,
        updatedAt: options.updatedAt ?? new Date(Date.now() - 60 * 60_000).toISOString() } },
    "@/lib/bms/rateLimit": { rateLimit: async () => ({ ok: options.allowed !== false, retryAfter: 30 }) },
    "@/lib/bms/webhookBody": { readBoundedWebhookText: async (_req: unknown, maxBytes: number) => {
      assert.equal(maxBytes, 256 * 1024);
      return options.boundedError ? { ok: false, ...options.boundedError }
        : { ok: true, text: typeof options.body === "string" ? options.body : JSON.stringify(options.body ?? { events: [] }) };
    } },
    "@/lib/bms/supportDiagnostics": { recordSupportEventsDetailed: async (input: unknown) => {
      ingested.push(input);
      if (options.writerFails) throw new Error("writer unavailable");
      return { accepted: 1, duplicate: 0, rejected: 0,
        results: [{ index: 0, eventId: randomUUID(), status: "accepted" }] };
    } },
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
  });
  const req = { headers: { get: (name: string) => name === "authorization" ? "Bearer valid-token" : null } };
  return { post: () => route.POST(req), ingested };
}

test("the device endpoint derives tenant, branch and device, and returns per-item ACK", async () => {
  const eventId = randomUUID();
  const h = harness({ body: { events: [{ eventId, tenantId: randomUUID(),
    occurredAt: new Date().toISOString(),
    deviceId: randomUUID(), locationId: randomUUID(), category: "admin", sessionId: "private",
    context: { source: "desktop-pos", token: "secret" } }] } });
  const response = await h.post();
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.results.map((item: { status: string }) => item.status), ["accepted"]);
  assert.equal(h.ingested[0].tenantId, tenantId);
  assert.equal(h.ingested[0].events[0].deviceId, deviceId);
  assert.equal(h.ingested[0].events[0].locationId, locationId);
  assert.equal(h.ingested[0].events[0].category, "pos");
  assert.equal(h.ingested[0].events[0].sessionId, null);
});

test("delayed evidence before the latest device edit cannot be falsely assigned to its current branch", async () => {
  const h = harness({ updatedAt: new Date().toISOString(), body: { events: [{
    eventId: randomUUID(), occurredAt: new Date(Date.now() - 60_000).toISOString(),
    locationId: locationId, deviceId,
  }] } });
  await h.post();
  assert.equal(h.ingested[0].events[0].locationId, null);
  assert.equal(h.ingested[0].events[0].deviceId, deviceId);
});

test("auth, throttling, malformed and oversized payloads fail before ingestion", async () => {
  for (const [options, status] of [
    [{ authenticated: false }, 401], [{ allowed: false }, 429],
    [{ body: "{" }, 400], [{ boundedError: { status: 413, error: "payload too large" } }, 413],
  ] as const) {
    const h = harness(options);
    assert.equal((await h.post()).status, status);
    assert.equal(h.ingested.length, 0);
  }
});

test("a failed database writer never returns an accepted ACK", async () => {
  const h = harness({ writerFails: true, body: { events: [{ eventId: randomUUID() }] } });
  await assert.rejects(h.post(), /writer unavailable/);
});
