import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./testing/webhookHarness.mts";

function inboxHarness(failAt: number | null = null, newlyInserted = false) {
  const incidents: any[] = [];
  let queries = 0;
  const inbox = loadWithStubs("apps/web/lib/bms/inbox.ts", {
    "@/lib/db": { query: async () => {
      queries++;
      if (queries === failAt) throw new Error("FAKE persistence failure");
      if (queries === 1) return { rows: [{ customer_id: "FAKE-customer-id" }] };
      if (queries === 2) return { rows: [{ id: "FAKE-conversation", inserted: newlyInserted }] };
      if (queries === 3) return { rows: [{ id: "FAKE-in", direction: "IN" }, { id: "FAKE-out", direction: "OUT" }] };
      return { rows: [] };
    } },
    "@/lib/pubsub": { pubsub: { publish: async () => {} } },
    "../../../../packages/graphql-core/src/bmsInboxSync": { topicBmsInboxChanged: () => "FAKE-topic" },
    "./channels": {}, "./channelHealth": {}, "@/lib/notifications/service": {},
    "./coupons": {}, "./tenant": {}, "./aiQuality": {}, "./customers": {},
    "./failureAlert": { reportBmsFailure: async (incident: any) => { incidents.push(incident); } },
  });
  return { incidents, log: (...args: any[]) => inbox.logConversation(...args), queryCount: () => queries };
}

test("Inbox reports failures at identity, conversation and message persistence without throwing", async () => {
  for (const failAt of [1, 2, 3]) {
    const h = inboxHarness(failAt);
    await h.log("FAKE-tenant", "line", "FAKE-ref", "FAKE private incoming", "FAKE private reply");
    assert.equal(h.incidents.length, 1);
    assert.equal(h.incidents[0].code, "inbox.message_lost");
    assert.equal(h.incidents[0].tenantId, "FAKE-tenant");
    assert.equal(h.incidents[0].customerRef, "FAKE-ref");
    assert.doesNotMatch(JSON.stringify(h.incidents[0]), /FAKE private/);
  }
});

test("Inbox does not report saved messages lost when assignment fails", async () => {
  const h = inboxHarness(4, true);
  await h.log("FAKE-tenant", "line", "FAKE-ref", "FAKE incoming", "FAKE reply");
  assert.equal(h.queryCount(), 4);
  assert.equal(h.incidents.length, 0);
});

test("Inbox success and intentional skips do not report failures", async () => {
  const h = inboxHarness();
  await h.log("FAKE-tenant", "line", "FAKE-ref", "FAKE incoming", "FAKE reply");
  await h.log("FAKE-tenant", "line", null, "FAKE incoming", "FAKE reply");
  await h.log("FAKE-tenant", "test", "FAKE-ref", "FAKE incoming", "FAKE reply");
  assert.equal(h.queryCount(), 3);
  assert.equal(h.incidents.length, 0);
});
