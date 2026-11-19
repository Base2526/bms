import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

function harness(options: { owner?: string; helper?: boolean; auditFails?: boolean;
  unread?: boolean } = {}) {
  const events: string[] = [];
  const client = { release() { events.push("release"); }, query: async (sql: string, args: any[] = []) => {
    if (sql.includes("FROM bms_conversations") && sql.includes("FOR UPDATE")) {
      events.push("lock-conversation");
      return { rows: [{ assigned_to_user_id: options.owner ?? "FAKE-owner" }], rowCount: 1 };
    }
    if (sql.includes("FROM bms_conversation_helpers") && sql.includes("FOR SHARE")) {
      events.push("check-helper");
      return { rows: options.helper ? [{ one: 1 }] : [], rowCount: options.helper ? 1 : 0 };
    }
    if (sql.includes("UPDATE bms_conversations SET status")) events.push(`status:${args[2]}`);
    if (sql.includes("UPDATE bms_conversations SET tags")) events.push(`tags:${args[2].join(",")}`);
    if (sql.includes("UPDATE bms_conversations SET unread")) {
      events.push("mark-read");
      return { rows: [], rowCount: options.unread === false ? 0 : 1 };
    }
    if (sql.includes("INSERT INTO bms_audit_log")) {
      events.push("audit");
      if (options.auditFails) throw new Error("FAKE audit failure");
    }
    if (sql === "COMMIT" || sql === "ROLLBACK") events.push(sql);
    return { rows: [], rowCount: 1 };
  } };
  const inbox = loadWithStubs("apps/web/lib/bms/inbox.ts", {
    "@/lib/db": { getClient: async () => client },
    "@/lib/pubsub": { pubsub: { publish: async () => { events.push("publish"); } } },
    "../../../../packages/graphql-core/src/bmsInboxSync": { topicBmsInboxChanged: () => "FAKE-topic" },
    "./tenant": { beginTenantTx: async (_client: unknown, tenant: string) => {
      assert.equal(tenant, "FAKE-tenant"); events.push("begin"); } },
    "@/lib/notifications/service": {}, "./channels": {}, "./channelHealth": {},
    "./coupons": {}, "./aiQuality": {}, "./customers": {}, "./customerAnswerEvidence": {},
    "./answerEvidenceStore": {}, "./failureAlert": {}, "./inboxMedia": {},
  });
  return { inbox, events };
}

test("status and tags recheck Sales scope and audit before commit", async () => {
  const status = harness({ owner: "FAKE-sales" });
  assert.equal(await status.inbox.setConversationStatus("FAKE-tenant", "FAKE-chat", "CLOSED",
    { actor: "FAKE-actor", restrictedUserId: "FAKE-sales" }), true);
  assert.deepEqual(status.events.slice(0, 5), ["begin", "lock-conversation", "status:CLOSED", "audit", "COMMIT"]);
  const tags = harness({ helper: true });
  assert.equal(await tags.inbox.setConversationTags("FAKE-tenant", "FAKE-chat", ["VIP", "VIP"],
    { actor: "FAKE-actor", restrictedUserId: "FAKE-sales" }), true);
  assert.deepEqual(tags.events.slice(0, 6), ["begin", "lock-conversation", "check-helper",
    "tags:VIP", "audit", "COMMIT"]);
});

test("lost access cannot change status, tags or unread count", async () => {
  const h = harness();
  assert.equal(await h.inbox.setConversationStatus("FAKE-tenant", "FAKE-chat", "CLOSED",
    { actor: "FAKE-actor", restrictedUserId: "FAKE-sales" }), false);
  assert.equal(await h.inbox.setConversationTags("FAKE-tenant", "FAKE-chat", ["VIP"],
    { actor: "FAKE-actor", restrictedUserId: "FAKE-sales" }), false);
  assert.equal(await h.inbox.markRead("FAKE-tenant", "FAKE-chat",
    { restrictedUserId: "FAKE-sales" }), false);
  assert.equal(h.events.some(event => event.startsWith("status:") || event.startsWith("tags:") ||
    event === "mark-read" || event === "audit"), false);
});

test("audit failure rolls status back; mark-read only publishes on a changed unread count", async () => {
  const failed = harness({ owner: "FAKE-sales", auditFails: true });
  await assert.rejects(failed.inbox.setConversationStatus("FAKE-tenant", "FAKE-chat", "CLOSED",
    { actor: "FAKE-actor", restrictedUserId: "FAKE-sales" }), /FAKE audit failure/);
  assert.ok(failed.events.includes("ROLLBACK"));
  assert.equal(failed.events.includes("COMMIT"), false);
  const read = harness({ owner: "FAKE-sales", unread: false });
  assert.equal(await read.inbox.markRead("FAKE-tenant", "FAKE-chat",
    { restrictedUserId: "FAKE-sales" }), true);
  assert.equal(read.events.includes("publish"), false);
});
