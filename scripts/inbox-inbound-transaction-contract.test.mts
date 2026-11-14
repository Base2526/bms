import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

const TENANT = "00000000-0000-4000-8000-000000000001";
const CHAT = "00000000-0000-4000-8000-000000000002";

function harness(options: { failAt?: "message" | "audit"; inserted?: boolean;
  assignmentFails?: boolean } = {}) {
  const events: string[] = [];
  let clients = 0;
  const client = {
    release() { events.push("release"); },
    async query(sql: string, args: unknown[] = []) {
      if (sql === "COMMIT" || sql === "ROLLBACK") {
        events.push(sql); return { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO bms_conversations")) {
        assert.equal(args[0], TENANT);
        events.push("conversation");
        return { rows: [{ id: CHAT, inserted: options.inserted ?? false }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO bms_messages")) {
        assert.deepEqual(args.slice(0, 2), [TENANT, CHAT]);
        events.push("message");
        if (options.failAt === "message") throw new Error("FAKE message failure");
        return { rows: [{ id: "42", created_at: new Date(0) }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO bms_audit_log")) {
        assert.equal(args[0], TENANT);
        events.push("audit");
        if (options.failAt === "audit") throw new Error("FAKE audit failure");
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const inbox = loadWithStubs("apps/web/lib/bms/inbox.ts", {
    "@/lib/db": {
      query: async (sql: string, args: unknown[]) => {
        assert.match(sql, /FROM bms_customer_identities/);
        assert.deepEqual(args, [TENANT, "line", "customer-ref"]);
        return { rows: [{ customer_id: "FAKE-customer" }], rowCount: 1 };
      },
      getClient: async () => {
        clients++;
        if (clients > 1 && options.assignmentFails) throw new Error("FAKE assignment failure");
        return client;
      },
    },
    "./tenant": { beginTenantTx: async (_client: unknown, tenantId: string) => {
      assert.equal(tenantId, TENANT); events.push("begin");
    } },
    "@/lib/pubsub": { pubsub: { publish: async () => { events.push("publish"); } } },
    "../../../../packages/graphql-core/src/bmsInboxSync": { topicBmsInboxChanged: () => "FAKE-topic" },
    "@/lib/notifications/service": {}, "./channels": {}, "./channelHealth": {},
    "./coupons": {}, "./aiQuality": {}, "./customers": {},
    "./customerAnswerEvidence": {}, "./answerEvidenceStore": {},
    "./failureAlert": {}, "./inboxMedia": {},
  });
  return { inbox, events };
}

test("non-AI inbound conversation and message commit together", async () => {
  const h = harness();
  assert.equal(await h.inbox.logInboundMessage(TENANT, "line", "customer-ref", {
    body: "", attachment: { url: "https://example.test/image.png", mimeType: "image/png" },
  }), CHAT);
  assert.deepEqual(h.events.slice(0, 5), ["begin", "conversation", "message", "COMMIT", "release"]);
});

test("non-AI inbound message failure rolls the unread conversation update back", async () => {
  const h = harness({ failAt: "message" });
  assert.equal(await h.inbox.logInboundMessage(TENANT, "line", "customer-ref", { body: "photo" }), null);
  assert.deepEqual(h.events.slice(0, 5), ["begin", "conversation", "message", "ROLLBACK", "release"]);
  assert.equal(h.events.includes("COMMIT"), false);
});

test("diagnostic message and audit commit together; audit failure rolls both back", async () => {
  const ok = harness();
  const result = await ok.inbox.createDiagnosticInboxMessage(TENANT, "line", "FAKE-admin", "test");
  assert.deepEqual([result.conversationId, result.messageId], [CHAT, "42"]);
  assert.deepEqual(ok.events.slice(0, 6), ["begin", "conversation", "message", "audit", "COMMIT", "release"]);

  const failed = harness({ failAt: "audit" });
  await assert.rejects(failed.inbox.createDiagnosticInboxMessage(TENANT, "line", "FAKE-admin", "test"),
    /FAKE audit failure/);
  assert.deepEqual(failed.events.slice(0, 6), ["begin", "conversation", "message", "audit", "ROLLBACK", "release"]);
});

test("post-commit auto-assignment failure does not mark saved inbound work as lost", async () => {
  const inbound = harness({ inserted: true, assignmentFails: true });
  assert.equal(await inbound.inbox.logInboundMessage(TENANT, "line", "customer-ref", { body: "photo" }), CHAT);
  assert.ok(inbound.events.includes("COMMIT"));
  const diagnostic = harness({ inserted: true, assignmentFails: true });
  assert.equal((await diagnostic.inbox.createDiagnosticInboxMessage(TENANT, "line", "FAKE-admin", "test"))
    .conversationId, CHAT);
  assert.ok(diagnostic.events.includes("COMMIT"));
});
