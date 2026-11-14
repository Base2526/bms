import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

const TENANT = "00000000-0000-4000-8000-000000000001";
const CHAT = "00000000-0000-4000-8000-000000000002";
const STAFF = "00000000-0000-4000-8000-000000000003";

function harness(options: { alreadyAssigned?: boolean; noStaff?: boolean; auditFails?: boolean;
  existingConversation?: boolean } = {}) {
  const events: string[] = [];
  const client = {
    release() { events.push("release"); },
    async query(sql: string, args: unknown[] = []) {
      if (sql === "COMMIT" || sql === "ROLLBACK") {
        events.push(sql);
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO bms_conversations")) {
        events.push("insert-conversation");
        return { rows: [{ id: CHAT, inserted: !options.existingConversation }], rowCount: 1 };
      }
      if (sql.includes("FROM bms_conversations") && sql.includes("FOR UPDATE")) {
        assert.deepEqual(args, [TENANT, CHAT]);
        events.push("lock");
        return { rows: [{ assigned_to_user_id: options.alreadyAssigned ? STAFF : null }], rowCount: 1 };
      }
      if (sql.includes("FROM users u") && sql.includes("ORDER BY")) {
        assert.equal(args[0], TENANT);
        events.push("select-staff");
        return options.noStaff || args[1] !== "Sales"
          ? { rows: [], rowCount: 0 } : { rows: [{ id: STAFF }], rowCount: 1 };
      }
      if (sql.includes("UPDATE bms_conversations")) {
        assert.match(sql, /assigned_to_user_id IS NULL/);
        assert.deepEqual(args, [TENANT, CHAT, STAFF]);
        events.push("update");
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO bms_audit_log")) {
        assert.deepEqual(args.slice(0, 2), [TENANT, CHAT]);
        events.push("audit");
        if (options.auditFails) throw new Error("FAKE audit failure");
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected transaction SQL: ${sql}`);
    },
  };
  const inbox = loadWithStubs("apps/web/lib/bms/inbox.ts", {
    "@/lib/db": {
      getClient: async () => client,
      query: async (sql: string, args: unknown[]) => {
        if (sql.includes("FROM bms_customer_identities")) {
          assert.equal(args[0], TENANT);
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected pool SQL: ${sql}`);
      },
    },
    "./tenant": { beginTenantTx: async (_client: unknown, tenantId: string) => {
      assert.equal(tenantId, TENANT); events.push("begin");
    } },
    "@/lib/pubsub": { pubsub: { publish: async () => undefined } },
    "../../../../packages/graphql-core/src/bmsInboxSync": { topicBmsInboxChanged: () => "FAKE-topic" },
    "@/lib/notifications/service": {}, "./channels": {}, "./channelHealth": {},
    "./coupons": {}, "./aiQuality": {}, "./customers": {},
    "./customerAnswerEvidence": {}, "./answerEvidenceStore": {},
    "./failureAlert": {}, "./inboxMedia": {},
  });
  return { inbox, events };
}

test("new Inbox conversation assigns staff and records audit in one tenant transaction", async () => {
  const h = harness();
  assert.equal(await h.inbox.ensureConversationForPipeline(TENANT, "line", "customer", "hello"), CHAT);
  assert.deepEqual(h.events, ["begin", "insert-conversation", "COMMIT", "release", "begin", "lock",
    "select-staff", "update", "audit", "COMMIT", "release"]);
});

test("auto-assignment leaves a human assignment, unavailable staff and existing conversations alone", async () => {
  for (const options of [{ alreadyAssigned: true }, { noStaff: true }, { existingConversation: true }]) {
    const h = harness(options);
    assert.equal(await h.inbox.ensureConversationForPipeline(TENANT, "line", "customer", "hello"), CHAT);
    assert.equal(h.events.includes("update"), false);
    assert.equal(h.events.includes("audit"), false);
  }
});

test("auto-assignment audit failure rolls its owner update back", async () => {
  const h = harness({ auditFails: true });
  assert.equal(await h.inbox.ensureConversationForPipeline(TENANT, "line", "customer", "hello"), CHAT);
  assert.ok(h.events.includes("update"));
  assert.deepEqual(h.events.slice(-2), ["ROLLBACK", "release"]);
  assert.equal(h.events.filter(event => event === "COMMIT").length, 1);
});
