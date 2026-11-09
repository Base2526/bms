import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

function retryHarness(initialStatus: string | null, channel = "line") {
  const row = { conversation_id: "FAKE-conversation", body: "FAKE reply", meta: initialStatus ? { status: initialStatus } : {} };
  let sends = 0;
  const sql: string[] = [];
  const client = { release() {}, query: async (statement: string, args: any[] = []) => {
    sql.push(statement);
    if (statement.includes("SELECT conversation_id, body, meta FROM bms_messages")) return { rows: [row], rowCount: 1 };
    if (statement.includes("SELECT channel, customer_ref FROM bms_conversations")) {
      return { rows: [{ channel, customer_ref: "FAKE-customer" }], rowCount: 1 };
    }
    if (statement.includes("UPDATE bms_messages SET meta")) {
      sends++;
      Object.assign(row.meta, JSON.parse(args[2]));
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
  });
  return { inbox, row, sql, sends: () => sends };
}

test("retry only sends failed push messages and never resends a successful reply", async () => {
  for (const status of ["PENDING", "SENT", "DELIVERED", "READ", null]) {
    const h = retryHarness(status);
    assert.deepEqual(await h.inbox.retryMessage("FAKE-tenant", "FAKE-message"), { status: "NOT_RETRYABLE" });
    assert.equal(h.sends(), 0);
    assert.ok(h.sql.some(statement => statement.includes("FOR UPDATE")));
  }
  const web = retryHarness("FAILED", "web");
  assert.deepEqual(await web.inbox.retryMessage("FAKE-tenant", "FAKE-message"), { status: "NOT_RETRYABLE" });
  assert.equal(web.sends(), 0);
});

test("a failed reply can be retried once and then becomes non-retryable", async () => {
  const h = retryHarness("FAILED");
  assert.deepEqual(await h.inbox.retryMessage("FAKE-tenant", "FAKE-message"), { status: "SENT", delivered: true });
  assert.equal(h.row.meta.status, "SENT");
  assert.deepEqual(await h.inbox.retryMessage("FAKE-tenant", "FAKE-message"), { status: "NOT_RETRYABLE" });
  assert.equal(h.sends(), 1);
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
