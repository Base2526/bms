import assert from "node:assert/strict";
import test from "node:test";
import { readBoundedWebhookText } from "../apps/web/lib/bms/webhookBody.ts";
import { loadWithStubs } from "./testing/webhookHarness.mts";

test("TikTok dev mock is off in production and saves text without AI in development", async () => {
  const calls = { claims: 0, saved: [] as any[], released: 0 };
  const route = loadWithStubs("apps/web/app/api/bms/tiktok/webhook/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, options?: { status?: number }) =>
      ({ body, status: options?.status ?? 200 }) } },
    "@/lib/bms/tenant": { DEFAULT_TENANT_ID: "FAKE-default" },
    "@/lib/bms/rateLimit": { rateLimit: async () => ({ ok: true, retryAfter: 0 }) },
    "@/lib/bms/webhookBody": { readBoundedWebhookText },
    "@/lib/bms/inboundEvents": {
      claimInboundEvent: async () => { calls.claims++; return true; },
      releaseUnprocessedInboundEvent: async () => { calls.released++; },
    },
    "@/lib/bms/inbox": { logInboundMessage: async (...args: unknown[]) => {
      calls.saved.push(args[3]); return "FAKE-conversation";
    } },
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
  });
  const previous = process.env.NODE_ENV;
  const request = () => new Request("http://localhost/mock", { method: "POST", body: JSON.stringify({
    messages: [{ id: "FAKE-event", user_id: "FAKE-user", content: { text: "ขอสั่งสินค้า" } }],
  }) });
  try {
    process.env.NODE_ENV = "production";
    assert.equal((await route.POST(request())).status, 404);
    assert.equal(calls.claims, 0);
    process.env.NODE_ENV = "development";
    const result = await route.POST(request());
    assert.equal(result.status, 200);
    assert.equal(calls.saved[0].body, "ขอสั่งสินค้า");
    assert.equal(calls.saved[0].meta.unsupportedForAi, true);
    assert.equal("reply" in result.body.replies[0], false);
    assert.equal(calls.released, 0);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
