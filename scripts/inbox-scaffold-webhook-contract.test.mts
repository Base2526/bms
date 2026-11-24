import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { loadWithStubs } from "./testing/webhookHarness.mts";
import { readBoundedWebhookText } from "../apps/web/lib/bms/webhookBody.ts";
import { verifyHexHmacSignature } from "../apps/web/lib/bms/crypto.ts";

for (const channel of ["tiktok", "shopee", "lazada"] as const) {
  function harness(saved: boolean) {
    const calls = { claims: 0, releases: [] as unknown[][], inbound: 0, savedInputs: [] as any[], pipeline: 0 };
    const route = loadWithStubs(`apps/web/app/api/bms/${channel}/webhook/[tenantId]/route.ts`, {
      "next/server": { NextResponse: { json: (body: unknown, options?: { status?: number }) => ({ body, status: options?.status ?? 200 }) } },
      "@/lib/bms/pipeline": { runPipeline: async () => { calls.pipeline++; return { reply: "FAKE-reply" }; } },
      "@/lib/bms/channels": { getChannel: async () => ({ active: true, channel_secret: "FAKE-secret" }) },
      "@/lib/bms/rateLimit": { rateLimit: async () => ({ ok: true }) },
      "@/lib/bms/webhookBody": { readBoundedWebhookText },
      "@/lib/bms/inbox": {
        logConversation: async () => "FAKE-conversation",
        logInboundMessage: async (...args: unknown[]) => {
          calls.inbound++; calls.savedInputs.push(args[3]); return saved ? "FAKE-conversation" : null;
        },
      },
      "@/lib/bms/channelHealth": { recordInboundEvent: async () => {}, recordWebhookVerifyFailed: async () => {} },
      "@/lib/bms/crypto": { verifyHexHmacSignature },
      "@/lib/bms/inboundEvents": {
        claimInboundEvent: async () => { calls.claims++; return true; },
        releaseUnprocessedInboundEvent: async (...args: unknown[]) => { calls.releases.push(args); },
      },
      "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
    });
    const postRaw = (raw: string) => {
      const signature = crypto.createHmac("sha256", "FAKE-secret").update(raw).digest("hex");
      const header = channel === "tiktok" ? "x-tiktok-signature" : `x-${channel}-signature`;
      return route.POST(new Request("https://example.test/webhook", {
        method: "POST", body: raw, headers: { [header]: signature },
      }),
        { params: { tenantId: "FAKE-tenant" } });
    };
    const post = (message: Record<string, unknown> | Record<string, unknown>[]) =>
      postRaw(JSON.stringify({ messages: Array.isArray(message) ? message : [message] }));
    const sender = channel === "tiktok" ? { user_id: "FAKE-user" }
      : channel === "shopee" ? { from_id: "FAKE-user" } : { buyer_id: "FAKE-user" };
    return { calls, post, postRaw, sender };
  }

  test(`${channel} rejects missing sender before claiming or running AI`, async () => {
    const h = harness(true);
    const response = await h.post({ id: "FAKE-event", content: { text: "hello" } });
    assert.equal(response.status, 400);
    assert.equal(h.calls.claims, 0);
    assert.equal(h.calls.pipeline, 0);
  });

  test(`${channel} rejects missing event ID and malformed text before claiming`, async () => {
    const h = harness(true);
    assert.equal((await h.post({ ...h.sender, content: { text: "hello" } })).status, 400);
    assert.equal((await h.post({ ...h.sender, id: "FAKE-event", content: { text: { invalid: true } } })).status, 400);
    assert.equal(h.calls.claims, 0);
    assert.equal(h.calls.pipeline, 0);
  });

  test(`${channel} rejects a malformed later item before persisting the first`, async () => {
    const h = harness(true);
    const response = await h.post([
      { ...h.sender, id: "FAKE-good", content: { text: "hello" } },
      { ...h.sender, content: { text: "missing id" } },
    ]);
    assert.equal(response.status, 400);
    assert.equal(h.calls.claims, 0);
    assert.equal(h.calls.inbound, 0);
  });

  test(`${channel} rejects malformed JSON and an oversized body before claiming events`, async () => {
    const h = harness(true);
    assert.equal((await h.postRaw("{")).status, 400);
    assert.equal((await h.postRaw("null")).status, 400);
    assert.equal((await h.postRaw("{}")).status, 400);
    assert.equal((await h.postRaw(" ".repeat(1024 * 1024 + 1))).status, 413);
    assert.equal(h.calls.claims, 0);
    assert.equal(h.calls.inbound, 0);
  });

  test(`${channel} rejects an oversized batch before any event claim`, async () => {
    const h = harness(true);
    const batch = Array.from({ length: 201 }, (_, index) => ({
      ...h.sender, id: `FAKE-${index}`, content: { text: "hello" },
    }));
    const response = await h.post(batch);
    assert.equal(response.status, 413);
    assert.equal(h.calls.claims, 0);
    assert.equal(h.calls.inbound, 0);
  });

  test(`${channel} media persistence failure releases the claim for safe provider retry`, async () => {
    const h = harness(false);
    await assert.rejects(h.post({ ...h.sender, id: "FAKE-event", content: { image_url: "https://example.test/photo.jpg" } }),
      /INBOUND_PERSIST_FAILED/);
    assert.equal(h.calls.inbound, 1);
    assert.equal(h.calls.pipeline, 0);
    assert.deepEqual(h.calls.releases, [["FAKE-tenant", channel, "FAKE-event"]]);
  });

  test(`${channel} records a valid media message once`, async () => {
    const h = harness(true);
    const response = await h.post({ ...h.sender, id: "FAKE-event", content: { image_url: "https://example.test/photo.jpg" } });
    assert.equal(response.status, 200);
    assert.equal(h.calls.inbound, 1);
    assert.equal(h.calls.releases.length, 0);
    assert.equal(h.calls.pipeline, 0);
  });

  test(`${channel} saves text for staff without running AI or claiming customer delivery`, async () => {
    const h = harness(true);
    const response = await h.post({ ...h.sender, id: "FAKE-text", content: { text: "ขอสั่งสินค้า" } });
    assert.equal(response.status, 200);
    assert.equal(h.calls.inbound, 1);
    assert.equal(h.calls.savedInputs[0].body, "ขอสั่งสินค้า");
    assert.equal(h.calls.savedInputs[0].meta.unsupportedForAi, true);
    assert.equal(h.calls.pipeline, 0);
    assert.equal("reply" in (response.body as any).replies[0], false);
  });

  test(`${channel} keeps a media attachment alongside its caption`, async () => {
    const h = harness(true);
    const response = await h.post({ ...h.sender, id: "FAKE-caption-media",
      content: { text: "ช่วยดูรูปนี้", image_url: "https://example.test/photo.jpg" } });
    assert.equal(response.status, 200);
    assert.equal(h.calls.savedInputs[0].body, "ช่วยดูรูปนี้");
    assert.equal(h.calls.savedInputs[0].attachment.url, "https://example.test/photo.jpg");
    assert.equal(h.calls.savedInputs[0].meta.unsupportedForAi, true);
    assert.equal(h.calls.pipeline, 0);
  });

  test(`${channel} text persistence failure releases its claim without running AI`, async () => {
    const h = harness(false);
    await assert.rejects(h.post({ ...h.sender, id: "FAKE-text", content: { text: "ขอสั่งสินค้า" } }),
      /INBOUND_PERSIST_FAILED/);
    assert.equal(h.calls.pipeline, 0);
    assert.deepEqual(h.calls.releases, [["FAKE-tenant", channel, "FAKE-text"]]);
  });
}
