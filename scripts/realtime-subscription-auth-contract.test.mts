import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { makeRealtimeEventFixture } from "../packages/realtime/src/fixtures.ts";
import { canReceiveRealtimeEvent } from "../packages/realtime/src/subscriptionAuth.ts";
import type { RealtimeTicketClaims } from "../packages/realtime/src/wsTicket.ts";

const coreResolvers = readFileSync(
  new URL("../packages/graphql-core/src/resolvers.ts", import.meta.url),
  "utf8",
);

const TENANT_A = "22222222-2222-4222-8222-222222222222";
const TENANT_B = "44444444-4444-4444-8444-444444444444";
const BRANCH_1 = "55555555-5555-4555-8555-555555555555";
const BRANCH_2 = "66666666-6666-4666-8666-666666666666";
const DEVICE = "77777777-7777-4777-8777-777777777777";
const USER = "88888888-8888-4888-8888-888888888888";

/** ทุกโดเมนเปิด — เทสจะได้วัด "ตัวตัดสินสิทธิ์" ไม่ใช่วัดธง rollout */
const ENV_ALL_ON: Record<string, string> = {
  REALTIME_SUBSCRIPTIONS_ENABLED: "1", REALTIME_RESTAURANT_ENABLED: "1",
  REALTIME_ORDERS_ENABLED: "1", REALTIME_PAYMENTS_ENABLED: "1",
  REALTIME_INVENTORY_ENABLED: "1", REALTIME_INBOX_ENABLED: "1",
  REALTIME_SHIPPING_ENABLED: "1", REALTIME_PHARMACY_ENABLED: "1",
  REALTIME_ADMIN_ENABLED: "1", REALTIME_POS_ENABLED: "1",
};

function claims(overrides: Partial<RealtimeTicketClaims> = {}): RealtimeTicketClaims {
  return {
    version: 1,
    audience: "bms-realtime",
    ticketId: "t1",
    scope: "admin",
    subjectId: USER,
    tenantId: TENANT_A,
    permissions: ["order.view", "product.view"],
    allLocations: false,
    locationIds: [BRANCH_1],
    issuedAt: 0,
    expiresAt: 0,
    ...overrides,
  } as RealtimeTicketClaims;
}

const orderEvent = (overrides = {}) => makeRealtimeEventFixture("order.created", {
  tenantId: TENANT_A, locationId: BRANCH_1, entityType: "order", ...overrides,
});

/**
 * นี่คือด่านเดียวที่กันข้ามร้านบนสาย WS · เดิมมันเป็นฟังก์ชันภายในของไฟล์ resolver
 * จึงไม่มีใคร import ไปทดสอบได้ และเทสที่มีอยู่ตรวจได้แค่ว่า "มีการเรียกในซอร์ส"
 * ซึ่งเขียวได้แม้ตัวฟังก์ชันจะคืน true เสมอ
 */
test("an event never reaches a ticket from another tenant", () => {
  assert.equal(canReceiveRealtimeEvent(orderEvent(), claims(), ENV_ALL_ON), true);
  assert.equal(
    canReceiveRealtimeEvent(orderEvent({ tenantId: TENANT_B }), claims(), ENV_ALL_ON),
    false,
    "ร้านอื่นต้องไม่ได้รับ",
  );
  assert.equal(
    canReceiveRealtimeEvent(orderEvent(), claims({ tenantId: TENANT_B }), ENV_ALL_ON),
    false,
  );
  // ticket ที่ไม่มี tenant เลย (เช่น scope ระดับผู้ใช้) ต้องไม่กลายเป็น "ผ่านหมด"
  assert.equal(
    canReceiveRealtimeEvent(orderEvent(), claims({ tenantId: undefined }), ENV_ALL_ON),
    false,
  );
});

test("a branch-scoped event never reaches a ticket scoped to another branch", () => {
  assert.equal(
    canReceiveRealtimeEvent(orderEvent({ locationId: BRANCH_2 }), claims(), ENV_ALL_ON),
    false,
    "สาขาอื่นต้องไม่ได้รับ",
  );
  assert.equal(
    canReceiveRealtimeEvent(
      orderEvent({ locationId: BRANCH_2 }), claims({ allLocations: true }), ENV_ALL_ON,
    ),
    true,
  );
  // event ที่ลืม scope ต้องตก ไม่ใช่กลายเป็น broadcast ทั้งร้าน
  assert.equal(
    canReceiveRealtimeEvent(
      orderEvent({ locationId: undefined }), claims({ allLocations: true }), ENV_ALL_ON,
    ),
    false,
  );
});

test("a device event reaches only that register, and only a POS ticket", () => {
  const deviceEvent = makeRealtimeEventFixture("device.session.changed", {
    tenantId: TENANT_A, locationId: BRANCH_1, deviceId: DEVICE, entityType: "pos_device",
  });
  const posTicket = claims({ scope: "pos", subjectId: DEVICE, permissions: [] });
  assert.equal(canReceiveRealtimeEvent(deviceEvent, posTicket, ENV_ALL_ON), true);
  assert.equal(
    canReceiveRealtimeEvent(deviceEvent, claims({ scope: "pos", subjectId: USER, permissions: [] }), ENV_ALL_ON),
    false,
    "เครื่องอื่นต้องไม่ได้รับ",
  );
  assert.equal(
    canReceiveRealtimeEvent(deviceEvent, claims({ scope: "admin", subjectId: DEVICE, permissions: [] }), ENV_ALL_ON),
    false,
    "ticket ที่ไม่ใช่ POS ต้องไม่สวมเป็นเครื่อง",
  );
});

test("a missing permission or a disabled domain fails closed", () => {
  assert.equal(
    canReceiveRealtimeEvent(orderEvent(), claims({ permissions: [] }), ENV_ALL_ON),
    false,
    "ไม่มี order.view ต้องไม่ได้รับ",
  );
  assert.equal(canReceiveRealtimeEvent(orderEvent(), claims(), {}), false, "ไม่ตั้งธง = ปิด");
  assert.equal(
    canReceiveRealtimeEvent(orderEvent(), claims(), { REALTIME_SUBSCRIPTIONS_ENABLED: "1" }),
    false,
    "เปิดสวิตช์ใหญ่อย่างเดียวไม่พอ ต้องเปิดโดเมนด้วย",
  );
});

/**
 * subscription ยุคก่อน BMS รับ id จากผู้เรียก · `apps/ws` ต่อฐานข้อมูลไม่ได้ ตัวกรองจึงต้อง
 * ตัดสินจากข้อมูลที่ publisher ส่งมากับ event — ไม่ใช่เชื่อ id ที่ client พิมพ์มาเอง
 */
test("chat subscriptions filter by the recipients carried on the event", () => {
  const block = (name: string) => {
    const start = coreResolvers.indexOf(`    ${name}: {`);
    assert.notEqual(start, -1, `${name} must exist`);
    const end = coreResolvers.indexOf("\n    },", start);
    assert.notEqual(end, -1, `${name} must be delimited`);
    return coreResolvers.slice(start, end);
  };
  for (const name of ["messageAdded", "messageDeleted"]) {
    const source = block(name);
    assert.match(source, /requireRealtimeUserId\(ctx\)/, `${name} must identify the subscriber`);
    // การตัดสินต้องขึ้นกับผู้รับจริง ไม่ใช่ "มีชื่อฟิลด์นั้นอยู่ในบล็อก"
    assert.match(
      source,
      /\.map\(String\)\.includes\(userId\)/,
      `${name} must decide from the recipients on the event`,
    );
    assert.doesNotMatch(source, /return true;/, `${name} must not accept everything`);
    assert.doesNotMatch(
      source,
      /\(payload\)\s*=>\s*typeof payload\?\.\w+ === "string"\s*\)/,
      `${name} must not accept every event on the topic`,
    );
  }
  assert.match(block("messageAdded"), /to_user_ids/);
  assert.match(block("messageDeleted"), /messageDeletedAudience/);
  // commentDeleted เคยคืน true เสมอ = ยิงการลบของทุกโพสต์ให้ทุกคน
  assert.match(block("commentDeleted"), /commentDeletedPostId/);
  assert.doesNotMatch(block("commentDeleted"), /return true;/);
});

test("the publishers send the routing data those filters need", () => {
  const web = readFileSync(
    new URL("../apps/web/graphql/resolvers.ts", import.meta.url),
    "utf8",
  );
  assert.match(web, /messageDeletedAudience:/, "message deletion must carry its chat members");
  assert.match(web, /FROM chat_members WHERE chat_id/);
  assert.match(web, /commentDeletedPostId:/, "comment deletion must carry its post");
});
