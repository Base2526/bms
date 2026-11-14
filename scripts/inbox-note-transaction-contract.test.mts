import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

function harness(options: { denied?: boolean; mentionFails?: boolean; auditFails?: boolean;
  notificationFails?: boolean } = {}) {
  const events: string[] = [];
  const client = { release() { events.push("release"); }, query: async (sql: string, args: any[] = []) => {
    if (sql.includes("FROM bms_conversations") && sql.includes("FOR UPDATE")) {
      events.push("lock-conversation");
      return { rows: [{ assigned_to_user_id: options.denied ? "FAKE-other" : "FAKE-sales" }], rowCount: 1 };
    }
    if (sql.includes("FROM bms_conversation_helpers") && sql.includes("FOR SHARE")) {
      events.push("check-helper"); return { rows: [], rowCount: 0 };
    }
    if (sql.includes("INSERT INTO bms_conversation_notes")) {
      events.push("insert-note");
      return { rows: [{ id: 41, author: "FAKE-actor", body: "hello", created_at: new Date(0) }], rowCount: 1 };
    }
    if (sql.includes("FROM users u JOIN roles r")) {
      assert.deepEqual(args[1], ["FAKE-user"]);
      events.push("validate-mentions");
      return { rows: [{ id: "FAKE-user" }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO bms_conversation_note_mentions")) {
      events.push("insert-mention");
      if (options.mentionFails) throw new Error("FAKE mention failure");
    }
    if (sql.includes("INSERT INTO bms_audit_log")) {
      assert.equal(JSON.parse(args[3]).mentionedCount, 1);
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
    "@/lib/notifications/service": { createNotification: async () => {
      events.push("notification");
      if (options.notificationFails) throw new Error("FAKE notification failure");
    } },
    "./channels": {}, "./channelHealth": {}, "./coupons": {}, "./aiQuality": {},
    "./customers": {}, "./customerAnswerEvidence": {}, "./answerEvidenceStore": {},
    "./failureAlert": {}, "./inboxMedia": {},
  });
  return { inbox, events };
}

test("note, deduplicated mentions and audit commit before notifications", async () => {
  const h = harness();
  const note = await h.inbox.addNote("FAKE-tenant", "FAKE-chat", "FAKE-actor", "hello",
    ["FAKE-user", "FAKE-user"], { restrictedUserId: "FAKE-sales" });
  assert.deepEqual(note.mentionedUserIds, ["FAKE-user"]);
  assert.deepEqual(h.events.slice(0, 7), ["begin", "lock-conversation", "insert-note",
    "validate-mentions", "insert-mention", "audit", "COMMIT"]);
  assert.ok(h.events.indexOf("notification") > h.events.indexOf("COMMIT"));
});

test("lost Sales access and empty body cannot write a note", async () => {
  const denied = harness({ denied: true });
  assert.equal(await denied.inbox.addNote("FAKE-tenant", "FAKE-chat", "FAKE-actor", "hello", null,
    { restrictedUserId: "FAKE-sales" }), null);
  assert.equal(denied.events.includes("insert-note"), false);
  const empty = harness();
  assert.equal(await empty.inbox.addNote("FAKE-tenant", "FAKE-chat", "FAKE-actor", "  "), null);
  assert.deepEqual(empty.events, []);
});

test("mention or audit failure rolls the note back; notification failure does not", async () => {
  for (const options of [{ mentionFails: true }, { auditFails: true }]) {
    const h = harness(options);
    await assert.rejects(h.inbox.addNote("FAKE-tenant", "FAKE-chat", "FAKE-actor", "hello",
      ["FAKE-user"], { restrictedUserId: "FAKE-sales" }));
    assert.ok(h.events.includes("ROLLBACK"));
    assert.equal(h.events.includes("COMMIT"), false);
    assert.equal(h.events.includes("notification"), false);
  }
  const notification = harness({ notificationFails: true });
  const note = await notification.inbox.addNote("FAKE-tenant", "FAKE-chat", "FAKE-actor", "hello",
    ["FAKE-user"], { restrictedUserId: "FAKE-sales" });
  assert.equal(note.id, 41);
  assert.ok(notification.events.includes("COMMIT"));
});
