import assert from "node:assert/strict";
import test from "node:test";

import { parseMetaEvents, parseMetaInboxSignals } from "../apps/web/lib/bms/meta.ts";
import { loadWithStubs } from "./testing/webhookHarness.mts";

const pageId = "123456789012345";
const customerRef = "998877665544";
const envelope = (messaging: any[]) => ({ object: "page", entry: [{ id: pageId, messaging }] });

test("Meta echo, delivery and read events are separated from customer turns", () => {
  const body = envelope([
    { sender: { id: pageId }, recipient: { id: customerRef }, timestamp: 1790000000000,
      message: { mid: "echo-mid", text: "ตอบจาก Business Suite", is_echo: true } },
    { sender: { id: customerRef }, recipient: { id: pageId },
      delivery: { mids: ["out-mid"], watermark: 1790000001000 } },
    { sender: { id: customerRef }, recipient: { id: pageId }, read: { watermark: 1790000002000 } },
  ]);
  assert.deepEqual(parseMetaEvents(body, pageId), []);
  assert.deepEqual(parseMetaInboxSignals(body, pageId).map((event) => event.kind), ["ECHO", "DELIVERY", "READ"]);
  assert.equal(parseMetaInboxSignals(body, pageId)[0].customerRef, customerRef);
  assert.deepEqual(parseMetaInboxSignals(body, "111111111111111"), []);
});

test("bounded reply, quick-reply and ad referral context survives the durable event", () => {
  const [event] = parseMetaEvents(envelope([{
    sender: { id: customerRef }, recipient: { id: pageId },
    message: { mid: "in-mid", text: "สนใจค่ะ", reply_to: { mid: "out-mid" }, quick_reply: { payload: "SKU-1" } },
    referral: { source: "ADS", type: "OPEN_THREAD", ref: "campaign-a", ad_id: "ad-123" },
  }]), pageId);
  assert.deepEqual(event.meta, {
    replyToMessageId: "out-mid",
    quickReplyPayload: "SKU-1",
    referral: { source: "ADS", type: "OPEN_THREAD", ref: "campaign-a", adId: "ad-123" },
  });
});

test("signal writes are tenant-scoped, idempotent and publish conversation refreshes", async () => {
  const calls = { sql: [] as string[], tenants: [] as string[], notifications: [] as any[] };
  const client = {
    release() {},
    query: async (sql: string) => {
      calls.sql.push(sql);
      if (sql.includes("SELECT m.id,m.conversation_id")) return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO bms_conversations")) return { rows: [{ id: "conversation-1" }], rowCount: 1 };
      if (sql.includes("INSERT INTO bms_messages")) return { rows: [], rowCount: 1 };
      if (sql.includes("UPDATE bms_messages m")) return { rows: [{ conversation_id: "conversation-1" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
  const service = loadWithStubs("apps/web/lib/bms/metaInboxSignals.ts", {
    "@/lib/db": { getClient: async () => client },
    "./tenant": { beginTenantTx: async (_client: any, tenantId: string) => { calls.tenants.push(tenantId); } },
    "./customers": { resolveOrCreateCustomer: async () => "customer-1" },
    "./inbox": {
      messagePreview: (body: string) => body || "[attachment]",
      notifyInboxConversationChanged: (...args: any[]) => calls.notifications.push(args),
    },
  });
  const signals = parseMetaInboxSignals(envelope([
    { sender: { id: pageId }, recipient: { id: customerRef }, timestamp: 1790000000000,
      message: { mid: "echo-mid", text: "ตอบแล้ว", is_echo: true } },
    { sender: { id: customerRef }, recipient: { id: pageId }, delivery: { mids: ["echo-mid"], watermark: 1790000001000 } },
    { sender: { id: customerRef }, recipient: { id: pageId }, read: { watermark: 1790000002000 } },
  ]), pageId);
  const result = await service.applyMetaInboxSignals("tenant-1", "facebook", signals);
  assert.deepEqual(result, { echoes: 1, deliveries: 1, reads: 1 });
  assert.deepEqual(calls.tenants, ["tenant-1"]);
  assert.equal(calls.sql.at(-1), "COMMIT");
  assert.deepEqual(calls.notifications, [["tenant-1", "conversation-1", "MESSAGES_CHANGED"]]);
});
