import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

test("Inbox helper, workload and audit-name reads bind users to the active tenant", async () => {
  const statements: { sql: string; args: unknown[] }[] = [];
  const inbox = loadWithStubs("apps/web/lib/bms/inbox.ts", {
    "@/lib/db": { query: async (sql: string, args: unknown[]) => {
      statements.push({ sql, args });
      if (sql.includes("FROM bms_audit_log")) return { rowCount: 1, rows: [{
        id: 1, actor: "staff@example.test", action: "inbox.assign",
        meta: { toUserId: "00000000-0000-4000-8000-000000000001" }, created_at: new Date(0),
      }] };
      return { rowCount: 0, rows: [] };
    } },
    "@/lib/pubsub": { pubsub: { publish: async () => undefined } },
    "../../../../packages/graphql-core/src/bmsInboxSync": { topicBmsInboxChanged: () => "FAKE-topic" },
    "@/lib/notifications/service": {},
    "./tenant": {},
    "./channels": {}, "./channelHealth": {}, "./coupons": {}, "./aiQuality": {},
    "./customers": {}, "./customerAnswerEvidence": {}, "./answerEvidenceStore": {},
    "./failureAlert": {}, "./inboxMedia": {},
  });

  await inbox.listConversations("FAKE-tenant", { assignedTo: "FAKE-user" });
  await inbox.countUnreadConversations("FAKE-tenant", "FAKE-user");
  await inbox.listMyMentions("FAKE-tenant", "FAKE-user");
  await inbox.listAssignableStaff("FAKE-tenant");
  await inbox.listConversationHelpers("FAKE-tenant", "FAKE-chat");
  const events = await inbox.listSystemEvents("FAKE-tenant", "FAKE-chat");
  assert.equal(events[0].targetName, "ผู้ใช้ที่ถูกลบ");

  const conversations = statements.find(({ sql }) => sql.includes("FROM bms_conversations c") &&
    sql.includes("LEFT JOIN bms_customers cu"));
  assert.match(conversations?.sql ?? "", /cu\.tenant_id = c\.tenant_id/);
  assert.match(conversations?.sql ?? "", /au\.tenant_id = c\.tenant_id/);
  assert.match(conversations?.sql ?? "", /h\.tenant_id = c\.tenant_id/);
  const unread = statements.find(({ sql }) => sql.includes("SELECT COUNT(*) AS total") &&
    sql.includes("c.unread > 0"));
  assert.match(unread?.sql ?? "", /h\.tenant_id = c\.tenant_id/);
  const mentions = statements.find(({ sql }) => sql.includes("FROM bms_conversation_note_mentions m") &&
    sql.includes("JOIN bms_conversation_notes n"));
  assert.match(mentions?.sql ?? "", /n\.tenant_id = m\.tenant_id/);
  assert.match(mentions?.sql ?? "", /c\.tenant_id = m\.tenant_id/);
  assert.match(mentions?.sql ?? "", /cu\.tenant_id = c\.tenant_id/);

  const workload = statements.find(({ sql }) => sql.includes("open_count"));
  assert.match(workload?.sql ?? "", /h\.tenant_id = c\.tenant_id/);
  assert.deepEqual(workload?.args, ["FAKE-tenant"]);
  const helpers = statements.find(({ sql }) => sql.includes("FROM bms_conversation_helpers h") &&
    sql.includes("JOIN users u"));
  assert.match(helpers?.sql ?? "", /u\.tenant_id = h\.tenant_id/);
  assert.deepEqual(helpers?.args, ["FAKE-tenant", "FAKE-chat", null]);
  const byId = statements.find(({ sql }) => sql.includes("FROM users WHERE tenant_id") &&
    sql.includes("uuid[]"));
  assert.deepEqual(byId?.args, ["FAKE-tenant", ["00000000-0000-4000-8000-000000000001"]]);
  const byEmail = statements.find(({ sql }) => sql.includes("FROM users WHERE tenant_id") &&
    sql.includes("text[]"));
  assert.deepEqual(byEmail?.args, ["FAKE-tenant", ["staff@example.test"]]);
});
