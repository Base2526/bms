import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

function harness(options: { owner?: string; helper?: boolean; eligibleTarget?: boolean;
  auditFails?: boolean } = {}) {
  const events: string[] = [];
  const client = { release() { events.push("release"); }, query: async (sql: string, args: any[] = []) => {
    if (sql.includes("FROM bms_conversations") && sql.includes("FOR UPDATE")) {
      assert.deepEqual(args.slice(0, 2), ["FAKE-tenant", "FAKE-chat"]);
      events.push("lock-conversation");
      return { rows: [{ assigned_to_user_id: options.owner ?? "FAKE-owner" }], rowCount: 1 };
    }
    if (sql.includes("FROM bms_conversation_helpers") && sql.includes("FOR SHARE")) {
      events.push("check-helper");
      return { rows: options.helper ? [{ "?column?": 1 }] : [], rowCount: options.helper ? 1 : 0 };
    }
    if (sql.includes("FROM users u JOIN roles r")) {
      assert.match(sql, /u\.tenant_id=\$1/);
      assert.match(sql, /FOR SHARE OF u/);
      events.push("check-target");
      return { rows: options.eligibleTarget === false ? [] : [{ id: "FAKE-target" }],
        rowCount: options.eligibleTarget === false ? 0 : 1 };
    }
    if (sql.includes("UPDATE bms_conversations SET assigned_to_user_id")) events.push("assign");
    if (sql.includes("DELETE FROM bms_conversation_helpers")) events.push("remove-duplicate-helper");
    if (sql.includes("INSERT INTO bms_audit_log")) {
      assert.deepEqual(args.slice(0, 3), ["FAKE-tenant", "FAKE-actor", "FAKE-chat"]);
      assert.deepEqual(JSON.parse(args[3]), { fromUserId: options.owner ?? "FAKE-owner", toUserId: "FAKE-target" });
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

test("assignment checks Sales scope and target, then commits owner/helper/audit together", async () => {
  const h = harness({ owner: "FAKE-sales" });
  assert.equal(await h.inbox.assignConversation("FAKE-tenant", "FAKE-chat", "FAKE-target",
    { actor: "FAKE-actor", restrictedUserId: "FAKE-sales" }), true);
  assert.deepEqual(h.events.slice(0, 7), ["begin", "lock-conversation", "check-target", "assign",
    "remove-duplicate-helper", "audit", "COMMIT"]);
  assert.equal(h.events.includes("ROLLBACK"), false);
});

test("removed Sales access and ineligible targets cannot reassign", async () => {
  const denied = harness();
  assert.equal(await denied.inbox.assignConversation("FAKE-tenant", "FAKE-chat", "FAKE-target",
    { actor: "FAKE-actor", restrictedUserId: "FAKE-sales" }), false);
  assert.deepEqual(denied.events, ["begin", "lock-conversation", "check-helper", "COMMIT", "release"]);
  const badTarget = harness({ owner: "FAKE-sales", eligibleTarget: false });
  assert.equal(await badTarget.inbox.assignConversation("FAKE-tenant", "FAKE-chat", "FAKE-target",
    { actor: "FAKE-actor", restrictedUserId: "FAKE-sales" }), false);
  assert.equal(badTarget.events.includes("assign"), false);
  assert.equal(badTarget.events.includes("audit"), false);
});

test("a helper can reassign, and audit failure rolls the assignment back", async () => {
  const helper = harness({ helper: true });
  assert.equal(await helper.inbox.assignConversation("FAKE-tenant", "FAKE-chat", "FAKE-target",
    { actor: "FAKE-actor", restrictedUserId: "FAKE-sales" }), true);
  assert.ok(helper.events.indexOf("check-helper") < helper.events.indexOf("assign"));
  const failed = harness({ owner: "FAKE-sales", auditFails: true });
  await assert.rejects(failed.inbox.assignConversation("FAKE-tenant", "FAKE-chat", "FAKE-target",
    { actor: "FAKE-actor", restrictedUserId: "FAKE-sales" }), /FAKE audit failure/);
  assert.ok(failed.events.includes("ROLLBACK"));
  assert.equal(failed.events.includes("COMMIT"), false);
});
