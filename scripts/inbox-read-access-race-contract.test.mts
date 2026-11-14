import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

const TENANT = "00000000-0000-4000-8000-000000000001";
const CHAT = "00000000-0000-4000-8000-000000000002";
const SALES = "00000000-0000-4000-8000-000000000003";

function harness(onQuery: (sql: string, args: unknown[]) => { rows: any[]; rowCount: number }) {
  return loadWithStubs("apps/web/lib/bms/inbox.ts", {
    "@/lib/db": { query: async (sql: string, args: unknown[]) => onQuery(sql, args) },
    "@/lib/pubsub": { pubsub: { publish: async () => undefined } },
    "../../../../packages/graphql-core/src/bmsInboxSync": { topicBmsInboxChanged: () => "FAKE-topic" },
    "@/lib/notifications/service": {}, "./tenant": {},
    "./channels": {}, "./channelHealth": {}, "./coupons": {}, "./aiQuality": {},
    "./customers": {}, "./customerAnswerEvidence": {}, "./answerEvidenceStore": {},
    "./failureAlert": {}, "./inboxMedia": {},
  });
}

function scoped(sql: string, args: unknown[]): boolean {
  return sql.includes("c.assigned_to_user_id") &&
    sql.includes("h.tenant_id = c.tenant_id") && args.at(-1) === SALES;
}

test("nested Inbox reads deny a Sales user after ownership changes", async () => {
  const statements: string[] = [];
  const inbox = harness((sql, args) => {
    statements.push(sql);
    if (scoped(sql, args)) return { rows: [], rowCount: 0 };
    return { rows: [{ id: CHAT, body: "private", customer_id: "private" }], rowCount: 1 };
  });
  assert.equal(await inbox.getConversation(TENANT, CHAT, SALES), null);
  assert.deepEqual(await inbox.listMessages(TENANT, CHAT, 20, SALES), []);
  assert.deepEqual(await inbox.listNotes(TENANT, CHAT, 20, SALES), []);
  assert.deepEqual(await inbox.listConversationHelpers(TENANT, CHAT, SALES), []);
  assert.deepEqual(await inbox.listSystemEvents(TENANT, CHAT, 20, SALES), []);
  assert.deepEqual(await inbox.getTimeline(TENANT, CHAT, 20, SALES), []);
  assert.equal(statements.length, 6);
  assert.ok(statements.every(sql => sql.includes("bms_conversations c")));
});

test("timeline checks Sales access again for each source after reassignment", async () => {
  let reads = 0;
  const inbox = harness((sql, args) => {
    reads++;
    if (reads === 1) {
      assert.ok(scoped(sql, args));
      return { rows: [{ customer_id: "00000000-0000-4000-8000-000000000004" }], rowCount: 1 };
    }
    // The owner changed immediately after the first statement. A missing scope
    // would expose a message, note, order or event from this later statement.
    return scoped(sql, args) ? { rows: [], rowCount: 0 } :
      { rows: [{ id: CHAT, body: "private", direction: "IN", created_at: new Date(0) }], rowCount: 1 };
  });
  assert.deepEqual(await inbox.getTimeline(TENANT, CHAT, 20, SALES), []);
  assert.equal(reads, 5);
});
