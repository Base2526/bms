import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

function harness(options: { owner?: string; actorHelper?: boolean; targetEligible?: boolean;
  duplicate?: boolean; missing?: boolean; auditFails?: boolean } = {}) {
  const events: string[] = [];
  const client = { release() { events.push("release"); }, query: async (sql: string, args: any[] = []) => {
    if (sql.includes("FROM bms_conversations") && sql.includes("FOR UPDATE")) {
      events.push("lock-conversation");
      return { rows: [{ assigned_to_user_id: options.owner ?? "FAKE-owner" }], rowCount: 1 };
    }
    if (sql.includes("FROM bms_conversation_helpers") && sql.includes("FOR SHARE")) {
      events.push("check-actor-helper");
      return { rows: options.actorHelper ? [{ one: 1 }] : [], rowCount: options.actorHelper ? 1 : 0 };
    }
    if (sql.includes("FROM users u JOIN roles r")) {
      assert.match(sql, /u\.tenant_id=\$1/);
      events.push("check-target");
      return { rows: options.targetEligible === false ? [] : [{ id: "FAKE-target" }],
        rowCount: options.targetEligible === false ? 0 : 1 };
    }
    if (sql.includes("INSERT INTO bms_conversation_helpers")) {
      events.push("add-helper");
      return { rows: [], rowCount: options.duplicate ? 0 : 1 };
    }
    if (sql.includes("DELETE FROM bms_conversation_helpers")) {
      events.push("remove-helper");
      return { rows: [], rowCount: options.missing ? 0 : 1 };
    }
    if (sql.includes("INSERT INTO bms_audit_log")) {
      assert.deepEqual(args.slice(0, 3), ["FAKE-tenant", "FAKE-actor", "FAKE-chat"]);
      assert.deepEqual(JSON.parse(args[3]), { userId: "FAKE-target" });
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

test("adding a helper checks Sales access and staff eligibility inside the audit transaction", async () => {
  const h = harness({ owner: "FAKE-sales" });
  assert.equal(await h.inbox.addConversationHelper("FAKE-tenant", "FAKE-chat", "FAKE-target",
    "FAKE-actor", { restrictedUserId: "FAKE-sales" }), true);
  assert.deepEqual(h.events.slice(0, 6), ["begin", "lock-conversation", "check-target",
    "add-helper", "audit", "COMMIT"]);
});

test("lost access, ineligible target and duplicate helper cannot add an audit or new helper", async () => {
  for (const options of [{}, { owner: "FAKE-sales", targetEligible: false },
    { owner: "FAKE-sales", duplicate: true }]) {
    const h = harness(options);
    assert.equal(await h.inbox.addConversationHelper("FAKE-tenant", "FAKE-chat", "FAKE-target",
      "FAKE-actor", { restrictedUserId: "FAKE-sales" }), false);
    assert.equal(h.events.includes("audit"), false);
  }
});

test("helper removal rechecks Sales access; audit failure rolls helper changes back", async () => {
  const denied = harness();
  assert.equal(await denied.inbox.removeConversationHelper("FAKE-tenant", "FAKE-chat", "FAKE-target",
    "FAKE-actor", { restrictedUserId: "FAKE-sales" }), false);
  assert.equal(denied.events.includes("remove-helper"), false);
  const allowed = harness({ owner: "FAKE-sales" });
  assert.equal(await allowed.inbox.removeConversationHelper("FAKE-tenant", "FAKE-chat", "FAKE-target",
    "FAKE-actor", { restrictedUserId: "FAKE-sales" }), true);
  assert.ok(allowed.events.indexOf("remove-helper") < allowed.events.indexOf("audit"));
  const failed = harness({ owner: "FAKE-sales", auditFails: true });
  await assert.rejects(failed.inbox.addConversationHelper("FAKE-tenant", "FAKE-chat", "FAKE-target",
    "FAKE-actor", { restrictedUserId: "FAKE-sales" }), /FAKE audit failure/);
  assert.ok(failed.events.includes("ROLLBACK"));
  assert.equal(failed.events.includes("COMMIT"), false);
});
