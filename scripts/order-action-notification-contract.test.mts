import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("committed customer orders notify branch-scoped staff, never POS counter sales", async () => {
  const source = await read("../apps/web/lib/bms/orderActionNotify.ts");
  assert.match(source, /o\.tenant_id = \$1 AND o\.id = \$2/);
  assert.match(source, /rp\.tenant_id = \$1/);
  assert.match(source, /REQUIRED_PERMISSIONS/);
  assert.match(source, /ORDER_PAID: \["order\.view", "order\.ship"\]/);
  assert.match(source, /KITCHEN_TICKETS_CREATED: \["order\.view", "restaurant\.kitchen\.update"\]/);
  assert.match(source, /unnest\(\$3::text\[\]\)/,
    "every permission required by the destination must be present");
  assert.match(source, /bms_user_allowed_locations/);
  assert.match(source, /COALESCE\(u\.pos_only, FALSE\) = FALSE/);
  assert.match(source, /order\.channel === "pos" && input\.kind !== "KITCHEN_TICKETS_CREATED"/);
  assert.match(source, /entity_type: "bms_order_action"/);
  assert.match(source, /o\.total_amount \+ o\.shipping_fee \+ COALESCE\(o\.rounding_amount, 0\)/,
    "the alert must show the same rounded amount that the customer actually pays");
  assert.match(source, /Promise\.race\(/);
  assert.match(source, /2_000/);
  assert.doesNotMatch(source, /customer_ref|customerName|phone|address/i,
    "staff alert payload must not broadcast customer PII");
});

test("order-created alert runs only after the owning transaction releases its client", async () => {
  const source = await read("../apps/web/lib/bms/orders.ts");
  const start = source.indexOf("export async function createOrder(");
  const end = source.indexOf("export type ReorderResult", start);
  const fn = source.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.ok(fn.indexOf("client.release()") < fn.indexOf("notifyOrderActionCommitted({"));
  assert.match(fn, /result\.status === "CREATED"/);
  assert.match(fn, /kind: "ORDER_CREATED"/);
});

test("paid handoff and kitchen handoff both produce staff notifications", async () => {
  const orders = await read("../apps/web/lib/bms/orders.ts");
  const payments = await read("../apps/web/lib/bms/payments.ts");
  assert.match(orders, /kind: "ORDER_PAID"/);
  assert.match(orders, /createdKitchenTickets[\s\S]{0,500}kind: "KITCHEN_TICKETS_CREATED"/);
  assert.equal((payments.match(/kind: "ORDER_PAID"/g) ?? []).length, 2,
    "both single-payment and split-payment confirmation paths must announce the paid order");

  for (const name of ["confirmPayment", "confirmPaymentsForOrder"]) {
    const start = payments.indexOf(`export async function ${name}(`);
    const next = payments.indexOf("\nexport ", start + 1);
    const fn = payments.slice(start, next < 0 ? payments.length : next);
    assert.ok(start >= 0, `${name} is missing`);
    assert.ok(fn.indexOf("client.release()") < fn.indexOf("notifyOrderActionCommitted({"),
      `${name} must release its transaction client before the notifier opens another connection`);
  }
});

test("global admin notifier gives sound, in-app toast, browser notification and refresh signal", async () => {
  const component = await read("../apps/web/components/GlobalOrderNotifier.tsx");
  const soundStatus = await read("../apps/web/components/GlobalStaffAlertSoundStatus.tsx");
  const session = await read("../apps/web/app/SessionLayer.tsx");
  assert.match(session, /<GlobalOrderNotifier \/>/);
  assert.match(session, /<GlobalStaffAlertSoundStatus \/>/);
  assert.match(component, /enabled = !loading && can\("order\.view"\)/);
  assert.match(component, /event\.entity_type !== "bms_order_action"/);
  assert.match(component, /alerts\.notify\(/);
  assert.match(component, /notification\.open\(/);
  assert.match(component, /await notify\(/);
  assert.match(component, /CustomEvent\("bms:order-action"/);
  assert.match(component, /claimStaffAlert\(`order:\$\{event\.id\}`\)/,
    "multiple open tabs must refresh, but only one may make noise");
  assert.doesNotMatch(component, /alerts\.blocked/, "the shared sound recovery banner must render only once");
  assert.match(soundStatus, /alerts\.blocked/);
  assert.match(soundStatus, /can\("inbox\.view"\) \|\| can\("order\.view"\)/);
});

test("Inbox alerts only for unread inbound work outside the active chat", async () => {
  const component = await read("../apps/web/components/GlobalInboxNotifier.tsx");
  const sync = await read("../packages/graphql-core/src/bmsInboxSync.ts");
  const schema = await read("../packages/graphql-core/src/typeDefs.ts");
  const inbox = await read("../apps/web/lib/bms/inbox.ts");

  assert.match(sync, /messageSource\?: "customer" \| "staff" \| "ai" \| "diagnostic"/);
  assert.match(sync, /messageId\?: string/);
  assert.match(schema, /messageSource: String/);
  assert.match(schema, /messageId: ID/);
  assert.match(inbox, /"MESSAGES_CHANGED", "customer"/);
  assert.match(inbox, /"MESSAGES_CHANGED", "staff"/);
  assert.equal((inbox.match(/"MESSAGES_CHANGED", "ai"/g) ?? []).length, 2);
  assert.match(component, /if \(ev\.messageSource !== "customer"\) return/);
  assert.doesNotMatch(component, /messageSource !== "diagnostic"/,
    "diagnostic messages must not ring every coworker's device");
  assert.match(component, /getGlobalInboxState\(\)\.activeConversationId === ev\.conversationId/);
  assert.match(component, /!conv\.unread/);
  assert.match(component, /seen\.current\.has\(eventKey\)/);
  assert.match(component, /processing\.current\.has\(eventKey\)/);
  assert.match(component, /ev\.messageId \|\| ev\.occurredAt/);
  assert.match(component, /claimStaffAlert\(`inbox:\$\{eventKey\}`\)/);
  assert.match(component, /alerts\.notify\("INBOX_MESSAGE"\)/);
  assert.match(component, /notification\.open\(/);
  assert.match(component, /await notify\(/);
});

test("cross-tab alert claims are serialized, bounded and fail open", async () => {
  const source = await read("../apps/web/lib/staffAlertClaim.ts");
  assert.match(source, /navigator\.locks\.request/);
  assert.match(source, /window\.localStorage/);
  assert.match(source, /MAX_CLAIMS = 200/);
  assert.match(source, /CLAIM_TTL_MS = 5 \* 60_000/);
  assert.match(source, /catch \{\s*return true;/,
    "storage/browser failures must not suppress a sale-critical alert");
});

test("orders page refreshes immediately from realtime and polls as recovery", async () => {
  const source = await read("../apps/web/app/(admin)/admin/orders/page.tsx");
  assert.match(source, /pollInterval: 15000/);
  assert.match(source, /addEventListener\("bms:order-action", refresh\)/);
  assert.match(source, /void refetch\(\)/);
});
