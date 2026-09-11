import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { REALTIME_EVENT_RULES, REALTIME_EVENT_TYPES } from "../packages/realtime/src/events.ts";
import { NAMED_REALTIME_SUBSCRIPTIONS } from "../packages/realtime/src/namedSubscriptions.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const typeDefs = read("../packages/graphql-core/src/typeDefs.ts");
const resolvers = read("../packages/graphql-core/src/resolvers.ts");

/** Phase 6 ระบุชื่อไว้ 17 ตัว — ครบทุกตัวคือสัญญากับฝั่ง RN */
const REQUIRED_SUBSCRIPTIONS = [
  "bmsDeviceSessionChanged", "bmsShiftChanged", "bmsPosOrderChanged",
  "bmsRestaurantFloorChanged", "bmsRestaurantCheckChanged", "bmsKitchenTicketChanged",
  "bmsMenuAvailabilityChanged", "bmsQrOrderChanged", "bmsIncomingOrderChanged",
  "bmsWaitlistChanged", "bmsInventoryChanged", "bmsStockTransferChanged",
  "bmsStockCountChanged", "bmsPaymentChanged", "bmsOrderChanged", "bmsInboxChanged",
  "bmsNotificationCreated",
] as const;

/**
 * event type ที่ยังไม่มี subscription แบบตั้งชื่อ — เข้าถึงได้ทาง `realtimeEvent` เท่านั้น
 * ลิสต์นี้มีไว้ให้ "ยังไม่ได้ทำ" อ่านเจอ · ชนิดใหม่ที่ไม่ถูกจัดที่ = แดง
 */
const GENERIC_STREAM_ONLY: Readonly<Record<string, string>> = {
  // brief ของ Phase 6 ไม่ได้ระบุ subscription ของการเรียกพนักงาน ทั้งที่เป็นจอจริงของ POS
  "restaurant.table_call.created": "no named subscription in the Phase 6 list",
  "restaurant.table_call.status_changed": "no named subscription in the Phase 6 list",
  "purchase.received": "back-office receiving; no named subscription requested",
  "shipment.created": "shipping surface; no named subscription requested",
  "shipment.status_changed": "shipping surface; no named subscription requested",
  "shipment.booking_failed": "shipping surface; no named subscription requested",
  "pharmacy.case.created": "pharmacy queue; no named subscription requested",
  "pharmacy.case.status_changed": "pharmacy queue; no named subscription requested",
  "pharmacy.case.assigned": "pharmacy queue; no named subscription requested",
  "dashboard.invalidated": "aggregate hint, not a single domain",
  // inbox มี subscription ของตัวเองอยู่ก่อน (`bmsInboxChanged`) ที่ใช้ payload คนละชนิด
  "inbox.conversation.changed": "served by the pre-existing bmsInboxChanged subscription",
  "inbox.message.created": "served by the pre-existing bmsInboxChanged subscription",
  "inbox.assignment.changed": "served by the pre-existing bmsInboxChanged subscription",
  "inbox.status.changed": "served by the pre-existing bmsInboxChanged subscription",
};

function subscriptionBlock(): string {
  const opener = /type Subscription\s*\{/.exec(typeDefs);
  assert.ok(opener, "Subscription type must exist");
  let depth = 1;
  let index = opener.index + opener[0].length;
  const start = index;
  while (index < typeDefs.length && depth > 0) {
    if (typeDefs[index] === "{") depth += 1;
    else if (typeDefs[index] === "}") depth -= 1;
    index += 1;
  }
  assert.equal(depth, 0, "Subscription type must be balanced");
  return typeDefs.slice(start, index - 1);
}

function declaredSubscriptionFields(): Set<string> {
  const fields = new Set<string>();
  for (const line of subscriptionBlock().split(/\r?\n/)) {
    const field = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[(:]/.exec(line);
    if (field) fields.add(field[1]);
  }
  assert.ok(fields.size > 10, "Subscription block must actually parse");
  return fields;
}

test("all 17 named domain subscriptions are declared in the schema", () => {
  const declared = declaredSubscriptionFields();
  for (const name of REQUIRED_SUBSCRIPTIONS) {
    assert.ok(declared.has(name), `${name} must be a Subscription field`);
  }
});

test("every named subscription maps to registered event types and has a resolver", () => {
  const registered = new Set<string>(REALTIME_EVENT_TYPES);
  // bmsInboxChanged เป็นของเดิม ใช้ payload คนละชนิด จึงไม่ได้อยู่ในตารางนี้
  const expected = REQUIRED_SUBSCRIPTIONS.filter((name) => name !== "bmsInboxChanged");
  assert.deepEqual(
    [...expected].sort(),
    Object.keys(NAMED_REALTIME_SUBSCRIPTIONS).sort(),
    "the generic-backed named subscriptions must match the Phase 6 list exactly",
  );
  for (const [field, eventTypes] of Object.entries(NAMED_REALTIME_SUBSCRIPTIONS)) {
    assert.ok(eventTypes.length > 0, `${field} must forward at least one event type`);
    for (const eventType of eventTypes) {
      assert.ok(registered.has(eventType), `${field} forwards unregistered ${eventType}`);
      assert.ok(REALTIME_EVENT_RULES[eventType], `${eventType} has no audience/permission rule`);
    }
  }
});

/**
 * 17 ชุด auth = 17 โอกาสที่ตัวหนึ่งจะหลุด · ทุกตัวต้องเดินผ่านตัวตัดสินกลางตัวเดียว
 * และต้องไม่รับ argument จาก client (ไม่มีทางให้ส่ง tenant/location มาเอง)
 */
test("named subscriptions share one auth path and accept no client arguments", () => {
  const factory = resolvers.slice(resolvers.indexOf("function namedDomainSubscriptions"));
  assert.ok(factory.length > 0, "factory must be found");
  assert.match(factory, /requireRealtimeClaims\(ctx\)/);
  assert.match(factory, /canReceiveRealtimeEvent\(event, requireRealtimeClaims\(ctx\)\)/);
  assert.match(factory, /validateRealtimeEvent\(payload\?\.realtimeEvent\)/);
  assert.match(factory, /realtimeTopics\(requireRealtimeClaims\(ctx\)\)/);
  // ไม่มี resolver ตัวไหนสร้าง topic จาก argument ของผู้เรียก
  assert.doesNotMatch(factory, /topicFor\w+\(\s*(?:args|_args|vars|variables)/);
  for (const line of subscriptionBlock().split(/\r?\n/)) {
    const named = /^\s*(bms[A-Za-z0-9_]*)\s*\(/.exec(line);
    if (named && (REQUIRED_SUBSCRIPTIONS as readonly string[]).includes(named[1])) {
      assert.fail(`${named[1]} must not take client arguments`);
    }
  }
});

test("every event type is reachable from a named subscription or recorded as generic-only", () => {
  const named = new Set<string>();
  for (const eventTypes of Object.values(NAMED_REALTIME_SUBSCRIPTIONS)) {
    for (const eventType of eventTypes) named.add(eventType);
  }
  const unreachable = REALTIME_EVENT_TYPES
    .filter((type) => !named.has(type) && !GENERIC_STREAM_ONLY[type])
    .sort();
  assert.deepEqual(
    unreachable,
    [],
    "event type ใหม่ต้องผูกกับ subscription ที่ตั้งชื่อ หรือถูกบันทึกว่าเข้าถึงได้ทางสตรีมรวมเท่านั้น",
  );
  const stale = Object.keys(GENERIC_STREAM_ONLY).filter((type) => named.has(type)).sort();
  assert.deepEqual(stale, [], "ชนิดที่มี subscription แล้วต้องไม่ค้างอยู่ในลิสต์ generic-only");
});
