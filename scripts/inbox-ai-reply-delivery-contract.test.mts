import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

function retryHarness(initialStatus: string | null, channel = "line", failFinal = false, denyAccess = false) {
  const row = { conversation_id: "FAKE-conversation", body: "FAKE reply", meta: initialStatus ? { status: initialStatus } : {} };
  let sends = 0;
  const sql: string[] = [];
  const client = { release() {}, query: async (statement: string, args: any[] = []) => {
    sql.push(statement);
    if (statement.includes("SELECT conversation_id, body, meta FROM bms_messages")) return { rows: [row], rowCount: 1 };
    if (statement.includes("SELECT channel, customer_ref FROM bms_conversations")) {
      if (denyAccess && args[2] === "FAKE-sales") return { rows: [], rowCount: 0 };
      return { rows: [{ channel, customer_ref: "FAKE-customer" }], rowCount: 1 };
    }
    if (statement.includes("UPDATE bms_messages SET meta")) {
      if (args[2] === undefined) row.meta.status = "PENDING";
      else {
        if (failFinal) throw new Error("FAKE final update failed");
        sends++;
        Object.assign(row.meta, JSON.parse(args[2]));
      }
    }
    return { rows: [], rowCount: 1 };
  } };
  const inbox = loadWithStubs("apps/web/lib/bms/inbox.ts", {
    "@/lib/db": { getClient: async () => client },
    "@/lib/pubsub": { pubsub: { publish: async () => {} } },
    "../../../../packages/graphql-core/src/bmsInboxSync": { topicBmsInboxChanged: () => "FAKE-topic" },
    "./channels": {}, "./channelHealth": {}, "@/lib/notifications/service": {},
    "./coupons": {}, "./tenant": { beginTenantTx: async () => {} }, "./aiQuality": {}, "./customers": {},
    "./customerAnswerEvidence": {}, "./answerEvidenceStore": {}, "./failureAlert": {},
    "./inboxMedia": { outboundInboxMediaUrl: async (_tenant: string, url: string) => url },
  });
  return { inbox, row, sql, sends: () => sends };
}

test("retry only sends failed push messages and never resends a successful reply", async () => {
  for (const status of ["PENDING", "PARTIAL", "SENT", "DELIVERED", "READ", null]) {
    const h = retryHarness(status);
    assert.deepEqual(await h.inbox.retryMessage("FAKE-tenant", "FAKE-message"), { status: "NOT_RETRYABLE" });
    assert.equal(h.sends(), 0);
    assert.ok(h.sql.some(statement => statement.includes("FOR UPDATE")));
  }
  const web = retryHarness("FAILED", "web");
  assert.deepEqual(await web.inbox.retryMessage("FAKE-tenant", "FAKE-message"), { status: "NOT_RETRYABLE" });
  assert.equal(web.sends(), 0);
});

test("Meta text accepted but image rejected is partial and cannot be retried as a whole message", async () => {
  let calls = 0;
  const inbox = loadWithStubs("apps/web/lib/bms/inbox.ts", {
    "@/lib/db": { query: async () => ({ rows: [{ allowed: true }], rowCount: 1 }) },
    "@/lib/pubsub": {},
    "../../../../packages/graphql-core/src/bmsInboxSync": {},
    "./channels": { getChannel: async () => ({ active: true, access_token: "FAKE-token", external_account_id: "FAKE-page" }) },
    "./channelHealth": { recordOutboundError: async () => {}, formatOutboundErrorDetail: () => "FAKE failure" },
    "@/lib/notifications/service": {}, "./coupons": {}, "./tenant": {}, "./aiQuality": {},
    "./customers": {}, "./customerAnswerEvidence": {}, "./answerEvidenceStore": {},
    "./failureAlert": {},
    "./inboxMedia": { outboundInboxMediaUrl: async (_tenant: string, url: string) => url },
  }, async () => {
    calls++;
    return calls === 1
      ? { ok: true, text: async () => '{"message_id":"FAKE-text-id"}' }
      : { ok: false, status: 400, text: async () => "FAKE image failure" };
  });
  const result = await inbox.deliverToChannelTracked("FAKE-tenant", "facebook", "real-customer", "hello", {
    url: "https://example.invalid/photo.png", mimeType: "image/png",
  });
  assert.deepEqual(result, { delivered: false, providerMessageIds: ["FAKE-text-id"], partial: true });
  assert.equal(calls, 2);
});

test("a provider transport timeout is uncertain, never a retryable rejection", async () => {
  for (const channel of ["line", "facebook"]) {
    const inbox = loadWithStubs("apps/web/lib/bms/inbox.ts", {
      "@/lib/db": { query: async () => ({ rows: [{ allowed: true }] }) },
      "@/lib/pubsub": {},
      "../../../../packages/graphql-core/src/bmsInboxSync": {},
      "./channels": { getChannel: async () => ({ active: true, access_token: "FAKE-token", external_account_id: "FAKE-page" }) },
      "./channelHealth": {}, "@/lib/notifications/service": {}, "./coupons": {}, "./tenant": {},
      "./aiQuality": {}, "./customers": {}, "./customerAnswerEvidence": {}, "./answerEvidenceStore": {},
      "./failureAlert": {}, "./inboxMedia": { outboundInboxMediaUrl: async (_tenant: string, url: string) => url },
    }, async () => { throw new Error("FAKE timeout after request"); });
    const result = await inbox.deliverToChannelTracked("FAKE-tenant", channel, "real-customer", "hello");
    assert.deepEqual(result, { delivered: false, providerMessageIds: [], uncertain: true });
  }
});

test("a failed reply can be retried once and then becomes non-retryable", async () => {
  const h = retryHarness("FAILED");
  assert.deepEqual(await h.inbox.retryMessage("FAKE-tenant", "FAKE-message"), { status: "SENT", delivered: true });
  assert.equal(h.row.meta.status, "SENT");
  assert.deepEqual(await h.inbox.retryMessage("FAKE-tenant", "FAKE-message"), { status: "NOT_RETRYABLE" });
  assert.equal(h.sends(), 1);
});

test("accepted retry with final DB failure remains PENDING and cannot resend", async () => {
  const h = retryHarness("FAILED", "line", true);
  assert.deepEqual(await h.inbox.retryMessage("FAKE-tenant", "FAKE-message"), { status: "SENT", delivered: true });
  assert.equal(h.row.meta.status, "PENDING");
  assert.deepEqual(await h.inbox.retryMessage("FAKE-tenant", "FAKE-message"), { status: "NOT_RETRYABLE" });
  assert.equal(h.sends(), 0);
});

test("Sales losing conversation access before retry claim cannot call provider", async () => {
  const h = retryHarness("FAILED", "line", false, true);
  assert.deepEqual(await h.inbox.retryMessage("FAKE-tenant", "FAKE-message", "FAKE-actor",
    { restrictedUserId: "FAKE-sales" }), { status: "NOT_FOUND" });
  assert.equal(h.sends(), 0);
  assert.equal(h.row.meta.status, "FAILED");
  assert.ok(h.sql.some(statement => statement.includes("FOR UPDATE") && statement.includes("assigned_to_user_id")));
});

test("provider acceptance stays delivered when the channel-health write fails", async () => {
  for (const channel of ["line", "facebook"]) {
    let pushes = 0;
    const inbox = loadWithStubs("apps/web/lib/bms/inbox.ts", {
      "@/lib/db": { query: async () => ({ rows: [{ allowed: true }] }) },
      "@/lib/pubsub": {},
      "../../../../packages/graphql-core/src/bmsInboxSync": {},
      "./channels": { getChannel: async () => ({ active: true, access_token: "FAKE-token", external_account_id: "FAKE-page" }) },
      "./channelHealth": { recordOutboundSuccess: async () => { throw new Error("FAKE health DB failed"); } },
      "@/lib/notifications/service": {}, "./coupons": {}, "./tenant": {}, "./aiQuality": {}, "./customers": {},
      "./customerAnswerEvidence": {}, "./answerEvidenceStore": {}, "./failureAlert": {},
      "./inboxMedia": { outboundInboxMediaUrl: async (_tenant: string, url: string) => url },
    }, async () => {
      pushes++;
      return { ok: true, text: async () => '{"message_id":"FAKE-provider-mid"}' };
    });
    const delivery = await inbox.deliverToChannelTracked("FAKE-tenant", channel, "real-customer", "reply");
    assert.equal(delivery.delivered, true);
    assert.equal(pushes, 1);
    if (channel === "facebook") assert.deepEqual(delivery.providerMessageIds, ["FAKE-provider-mid"]);
  }
});

test("private Inbox media needs a public HTTPS origin before calling the provider", async () => {
  const before = process.env.NEXT_PUBLIC_BASE_URL;
  delete process.env.NEXT_PUBLIC_BASE_URL;
  try {
    let calls = 0;
    const inbox = loadWithStubs("apps/web/lib/bms/inbox.ts", {
      "@/lib/db": {}, "@/lib/pubsub": {},
      "../../../../packages/graphql-core/src/bmsInboxSync": {},
      "./channels": {},
      "./channelHealth": { recordOutboundError: async () => {} },
      "@/lib/notifications/service": {}, "./coupons": {}, "./tenant": {},
      "./aiQuality": {}, "./customers": {}, "./customerAnswerEvidence": {},
      "./answerEvidenceStore": {}, "./failureAlert": {},
      "./inboxMedia": { outboundInboxMediaUrl: async (_tenant: string, url: string) => url },
    }, async () => { calls++; throw new Error("unexpected provider call"); });
    const result = await inbox.deliverToChannelTracked("FAKE-tenant", "line", "real-customer", "", {
      url: "/api/bms/inbox/media/1?token=FAKE", mimeType: "image/png",
    });
    assert.equal(result.delivered, false);
    assert.equal(calls, 0);
  } finally {
    if (before === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
    else process.env.NEXT_PUBLIC_BASE_URL = before;
  }
});
