/**
 * Restaurant POS (`9.44`) against a real Postgres.
 *
 * The retail register and the dine-in surface share one settlement engine, and every bug this
 * suite pins down came from the seams between them — not from the happy path:
 *
 *  - a check is opened on a waiter's tablet and paid at the counter, by a different person, often
 *    after the shift changed. `finalizePosSale()` locks a bill by (order, shift, device, cashier),
 *    so without a re-stamp that is "บิลไม่ตรงกับเครื่อง กะ หรือพนักงานผู้ขาย" in front of a customer,
 *    with the food already eaten and the ingredients reserved forever.
 *  - the reservation order carries an idempotency key derived from the check version. An abandoned
 *    order that keeps its key makes the *next* send at that version collide, and a stale stored key
 *    at settlement makes `recordPosSale()` open a **second** order and reserve the food twice.
 *  - `CLOSING` blocks edits and cancellation, so a failed payment must always put the check back.
 *  - dine-in tickets exist before any sale, which is why the board's `orderId` is nullable and why
 *    settlement must not enqueue a second copy of them.
 *
 * ⚠️ เขียนจริงลงฐาน — สร้าง tenant ของตัวเองแล้วลบทิ้ง **ห้ามรันกับ production** · ต้องสร้าง tenant
 * เองเพราะชุดนี้ตั้ง `business_archetype = 'restaurant'` ซึ่งเปลี่ยนพฤติกรรมของทุกบิลในร้านนั้น
 * (โน้ตใน CLAUDE.local.md: การยืมร้านจริงมาสลับ archetype ทำร้านค้างเป็นร้านยาจนเทส POS แดง 10 ตัว)
 */
import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import {
  KITCHEN_BULK_LIMIT,
  listKitchenTickets,
  updateKitchenTicketStatus,
  updateKitchenTicketsStatus,
} from "../apps/web/lib/bms/kitchen.ts";
import {
  clearKitchenStationSla,
  getKitchenStationSlaMap,
  listKitchenStationSlas,
  upsertKitchenStationSla,
} from "../apps/web/lib/bms/kitchenSla.ts";
import { cancelOrder, releaseExpiredOrders } from "../apps/web/lib/bms/orders.ts";
import { RESERVATION_LOST } from "../apps/web/lib/bms/restaurantPosErrors.ts";
import {
  addRestaurantCheckItem,
  cancelRestaurantCheck,
  createDefaultRestaurantFloor,
  getRestaurantCheck,
  listRestaurantFloor,
  moveRestaurantCheck,
  openRestaurantCheck,
  removeRestaurantCheckItem,
  sendRestaurantKitchenRound,
  settleRestaurantCheck,
  dropKitchenCancelledLineInTx,
} from "../apps/web/lib/bms/restaurantPos.ts";

const TAG = "restaurant-test";
const SIZE = "BASE";
const FOOD = `FAKE-${TAG}-PADTHAI`;
const DRINK = `FAKE-${TAG}-WATER`;

let tenantId = "";
let locationId = "";
let otherLocationId = "";
let deviceId = "";
let shiftA = "";
let shiftB = "";
let waiterId = "";
let cashierId = "";
let tables: Array<{ id: string; code: string }> = [];
let paidCheckId = "";

const stock = async (sku: string, location = locationId) =>
  (await query<{ current_stock: string; reserved_stock: string }>(
    `SELECT current_stock::text, reserved_stock::text FROM bms_inventory
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, location, sku, SIZE]
  )).rows[0];

// 9.51 made a declared sales surface a precondition for selling. These fixtures write
// bms_products directly, so nothing else declares one and every sale returns NOT_FOUND.
// The rows cascade away with the product on teardown.
const declareSalesSurfaces = async (sku: string, surfaces: string[]) => {
  const present = (await query<{ reg: string | null }>(
    `SELECT to_regclass('bms_product_sales_surfaces')::text AS reg`
  )).rows[0]?.reg;
  if (!present) return; // database predates 9.51
  for (const surface of surfaces) {
    await query(
      `INSERT INTO bms_product_sales_surfaces (tenant_id, product_sku, surface)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [tenantId, sku, surface]
    );
  }
};
const ALL_SURFACES = ["RETAIL_POS", "RESTAURANT_POS", "ONLINE_ORDER", "PUBLIC_STOREFRONT", "CUSTOMER_AI"];

async function makeUser(name: string) {
  return (await query<{ id: string }>(
    `INSERT INTO users (name, username, email, role, role_id, tenant_id, password_hash, fake_test)
     SELECT $2, $3, $3, 'Administrator', r.id, $1, 'x', TRUE
       FROM roles r WHERE r.name = 'Administrator' LIMIT 1
     RETURNING id`,
    [tenantId, `FAKE ${TAG} ${name}`, `fake-${TAG}-${name}-${Date.now()}@example.invalid`]
  )).rows[0].id;
}

test("setup: a throwaway restaurant with a register, an open shift and two plain menu items", async () => {
  tenantId = (await query<{ id: string }>(
    `INSERT INTO bms_tenants (name, slug) VALUES ($1,$2) RETURNING id`,
    [`FAKE ${TAG}`, `fake-${TAG}-${Date.now()}`]
  )).rows[0].id;
  locationId = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name, branch_code)
     VALUES ($1,'MAIN',$2,'00000') RETURNING id`, [tenantId, `FAKE ${TAG} branch`]
  )).rows[0].id;
  otherLocationId = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name, branch_code, is_head_office)
     VALUES ($1,'B2',$2,'00002',FALSE) RETURNING id`, [tenantId, `FAKE ${TAG} branch 2`]
  )).rows[0].id;
  await query(
    `INSERT INTO bms_store_profile (tenant_id, business_archetype) VALUES ($1,'restaurant')`,
    [tenantId]
  );
  // เมนูทั้งสองตัวเป็น DIRECT (ไม่มีสูตร) โดยตั้งใจ — นี่คือร้านที่ยังไม่ได้ผูกสูตรให้เมนูไหนเลย
  // ซึ่งเป็นสภาพจริงของร้านที่เพิ่งเปิดใช้ระบบ · ตั๋วครัวต้องเกิดอยู่ดี
  for (const [sku, price] of [[FOOD, 60], [DRINK, 15]] as const) {
    await query(
      `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category)
       VALUES ($1,$2,$2,$3,TRUE,'V')`, [tenantId, sku, price]
    );
    await query(
      `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
       VALUES ($1,$2,$3,$4,100,0)`, [tenantId, locationId, sku, SIZE]
    );
    await declareSalesSurfaces(sku, ALL_SURFACES);
  }
  waiterId = await makeUser("waiter");
  cashierId = await makeUser("cashier");
  deviceId = (await query<{ id: string }>(
    `INSERT INTO bms_pos_devices (tenant_id, location_id, code, name)
     VALUES ($1,$2,'POS-1',$3) RETURNING id`, [tenantId, locationId, `FAKE ${TAG} device`]
  )).rows[0].id;
  shiftA = (await query<{ id: string }>(
    `INSERT INTO bms_pos_shifts (tenant_id, location_id, device_id, opened_by, opening_float)
     VALUES ($1,$2,$3,$4,0) RETURNING id`, [tenantId, locationId, deviceId, waiterId]
  )).rows[0].id;
});

test("a default floor is idempotent and every table starts free", async () => {
  const floor = await createDefaultRestaurantFloor({
    tenantId, locationId, actorUserId: waiterId, tableCount: 4,
  });
  assert.equal(floor.areas.length, 1);
  assert.equal(floor.tables.length, 4);
  assert.ok(floor.tables.every((t) => t.status === "AVAILABLE" && t.check === null));
  // กดปุ่มสองครั้งต้องไม่ได้ผังซ้อน
  const again = await createDefaultRestaurantFloor({
    tenantId, locationId, actorUserId: waiterId, tableCount: 4,
  });
  assert.equal(again.areas.length, 1);
  assert.equal(again.tables.length, 4);
  tables = again.tables.map((t) => ({ id: t.id, code: t.code }));
});

test("the database rejects a table whose area belongs to another branch", async () => {
  const area = (await query<{ id: string }>(
    `SELECT id FROM bms_restaurant_areas WHERE tenant_id = $1 AND location_id = $2 LIMIT 1`,
    [tenantId, locationId]
  )).rows[0];
  await assert.rejects(
    () => query(
      `INSERT INTO bms_restaurant_tables
         (tenant_id, location_id, area_id, code, name, seats)
       VALUES ($1,$2,$3,'CROSS-BRANCH','must fail',2)`,
      [tenantId, otherLocationId, area.id]
    ),
    (error: any) => error?.code === "23503"
  );
});

test("the database rejects a restaurant check using another branch's device and shift", async () => {
  const otherDevice = (await query<{ id: string }>(
    `INSERT INTO bms_pos_devices (tenant_id, location_id, code, name)
     VALUES ($1,$2,'POS-B2',$3) RETURNING id`,
    [tenantId, otherLocationId, `FAKE ${TAG} branch 2 device`]
  )).rows[0].id;
  const otherShift = (await query<{ id: string }>(
    `INSERT INTO bms_pos_shifts (tenant_id, location_id, device_id, opened_by, opening_float)
     VALUES ($1,$2,$3,$4,0) RETURNING id`,
    [tenantId, otherLocationId, otherDevice, waiterId]
  )).rows[0].id;
  await assert.rejects(
    () => query(
      `INSERT INTO bms_restaurant_checks
         (tenant_id, location_id, table_id, pos_device_id, pos_shift_id, guest_count, opened_by)
       VALUES ($1,$2,$3,$4,$5,1,$6)`,
      [tenantId, locationId, tables[0].id, otherDevice, otherShift, waiterId]
    ),
    (error: any) => error?.code === "23503"
  );
});

test("one table holds at most one open check", async () => {
  const first = await openRestaurantCheck({
    tenantId, locationId, deviceId, shiftId: shiftA,
    tableId: tables[0].id, guestCount: 2, actorUserId: waiterId,
  });
  assert.equal(first?.status, "OPEN");
  await assert.rejects(
    () => openRestaurantCheck({
      tenantId, locationId, deviceId, shiftId: shiftA,
      tableId: tables[0].id, guestCount: 2, actorUserId: waiterId,
    }),
    /มีบิลเปิดอยู่แล้ว/
  );
  paidCheckId = first!.id;
});

test("sending a round reserves the ingredients and tickets every line, recipe or not", async () => {
  await addRestaurantCheckItem({
    tenantId, locationId, checkId: paidCheckId, actorUserId: waiterId,
    sku: FOOD, size: SIZE, packQty: 2, kitchenNote: "ไม่เผ็ด",
  });
  await addRestaurantCheckItem({
    tenantId, locationId, checkId: paidCheckId, actorUserId: waiterId,
    sku: DRINK, size: SIZE, packQty: 1,
  });
  const before = await getRestaurantCheck(tenantId, paidCheckId);
  assert.equal(before?.items.length, 2);
  assert.ok(before!.version > 0 && before!.reservedVersion === null, "ยังไม่ส่งครัว = ยังไม่จอง");

  const sent = await sendRestaurantKitchenRound({
    tenantId, locationId, deviceId, shiftId: shiftA, checkId: paidCheckId, actorUserId: waiterId,
  });
  assert.equal(sent.status, "SENT");
  assert.equal((sent as any).kitchenTickets, 2, "ทั้งอาหารและน้ำต้องขึ้นจอครัว");
  const check = (sent as any).check;
  assert.equal(check.version, check.reservedVersion);
  assert.equal(check.amountDue, 2 * 60 + 15);
  assert.ok(check.items.every((i: any) => i.status === "SENT" && i.roundNo === 1));
  assert.equal(Number((await stock(FOOD)).reserved_stock), 2);
  assert.equal(Number((await stock(DRINK)).reserved_stock), 1);
  assert.equal(Number((await stock(FOOD)).current_stock), 100, "จองไม่ใช่ตัดสต็อก");
});

test("a failed later round keeps the reservation for food already sent to the kitchen", async () => {
  const before = await getRestaurantCheck(tenantId, paidCheckId);
  const previousReservedVersion = before!.reservedVersion!;
  await addRestaurantCheckItem({
    tenantId, locationId, checkId: paidCheckId, actorUserId: waiterId,
    sku: DRINK, size: SIZE, packQty: 999,
  });

  const failed = await sendRestaurantKitchenRound({
    tenantId, locationId, deviceId, shiftId: shiftA, checkId: paidCheckId, actorUserId: waiterId,
  });
  assert.equal(failed.status, "INSUFFICIENT");
  assert.equal(Number((await stock(FOOD)).reserved_stock), 2,
    "อาหารรอบเดิมอยู่ในครัวแล้วจึงต้องยังถูกจอง");
  assert.equal(Number((await stock(DRINK)).reserved_stock), 1,
    "ของรอบเดิมต้องไม่ถูกปล่อยเพราะรอบสั่งเพิ่มล้ม");

  const restored = await getRestaurantCheck(tenantId, paidCheckId);
  assert.equal(restored!.reservedVersion, previousReservedVersion);
  assert.notEqual(restored!.version, restored!.reservedVersion,
    "รายการใหม่ยังไม่ส่งครัว จึงยังห้ามคิดเงิน");
  assert.equal(restored!.hasCurrentOrder, true, "ต้องผูก reservation ของรายการ SENT กลับเข้าบิล");

  const unsent = restored!.items.find((item) => item.status === "NEW");
  assert.ok(unsent);
  await removeRestaurantCheckItem({
    tenantId, locationId, checkId: paidCheckId, itemId: unsent.id, actorUserId: waiterId,
  });
  const resynced = await sendRestaurantKitchenRound({
    tenantId, locationId, deviceId, shiftId: shiftA, checkId: paidCheckId, actorUserId: waiterId,
  });
  assert.equal(resynced.status, "SENT");
  assert.equal((resynced as any).kitchenTickets, 0, "การ sync reservation ไม่สร้างตั๋วครัวซ้ำ");
});

test("a later round replaces the reservation, renumbers the round and frees the old key", async () => {
  const firstOrder = (await query<{ current_order_id: string }>(
    `SELECT current_order_id FROM bms_restaurant_checks WHERE tenant_id = $1 AND id = $2`,
    [tenantId, paidCheckId]
  )).rows[0].current_order_id;

  // ส่งซ้ำโดยไม่มีอะไรใหม่ = ไม่มีอะไรเกิด (กดปุ่มรัว ๆ)
  const noop = await sendRestaurantKitchenRound({
    tenantId, locationId, deviceId, shiftId: shiftA, checkId: paidCheckId, actorUserId: waiterId,
  });
  assert.equal(noop.status, "SENT");
  assert.equal((noop as any).kitchenTickets, 0);
  assert.equal(
    (await query<{ id: string }>(
      `SELECT current_order_id AS id FROM bms_restaurant_checks WHERE tenant_id = $1 AND id = $2`,
      [tenantId, paidCheckId])).rows[0].id,
    firstOrder,
    "ส่งซ้ำต้องไม่สร้างการจองใบใหม่"
  );

  await addRestaurantCheckItem({
    tenantId, locationId, checkId: paidCheckId, actorUserId: waiterId,
    sku: DRINK, size: SIZE, packQty: 3,
  });
  const pending = await getRestaurantCheck(tenantId, paidCheckId);
  assert.notEqual(pending!.version, pending!.reservedVersion);
  await assert.rejects(
    () => settleRestaurantCheck({
      tenantId, locationId, deviceId, shiftId: shiftA, checkId: paidCheckId,
      actorUserId: cashierId, payments: [{ method: "CASH", amount: 1 }],
    }),
    /ยังไม่ส่งครัว/,
    "ของที่ครัวยังไม่รับต้องไม่หลุดไปเป็นเงิน"
  );

  // ทำให้รอบใหม่จองทั้งบิลไม่พอ หลัง order เดิมถูกคืนชั่วคราวภายใน transaction
  // ผลล้มต้อง rollback กลับไปหา reservation เดิม ไม่ปล่อยให้อาหารรอบแรกทำต่อแบบไม่มีของจอง
  await query(
    `UPDATE bms_inventory SET current_stock = reserved_stock
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, DRINK, SIZE]
  );
  const refused = await sendRestaurantKitchenRound({
    tenantId, locationId, deviceId, shiftId: shiftA, checkId: paidCheckId, actorUserId: waiterId,
  });
  assert.equal(refused.status, "INSUFFICIENT");
  const preserved = await getRestaurantCheck(tenantId, paidCheckId);
  assert.equal(preserved!.hasCurrentOrder, true);
  assert.notEqual(preserved!.version, preserved!.reservedVersion,
    "รอบใหม่ยังไม่ถูกส่ง แต่ reservation รุ่นก่อนต้องยังผูกอยู่");
  assert.equal(
    (await query<{ id: string }>(
      `SELECT current_order_id AS id FROM bms_restaurant_checks WHERE tenant_id = $1 AND id = $2`,
      [tenantId, paidCheckId])).rows[0].id,
    firstOrder
  );
  assert.deepEqual(preserved!.items.map((item) => item.status), ["SENT", "SENT", "NEW"]);
  assert.equal(Number((await stock(DRINK)).reserved_stock), 1,
    "จองใหม่ไม่ผ่านต้องไม่คืน reservation ของรอบที่ครัวรับแล้ว");
  assert.equal(
    (await query<{ status: string }>(
      `SELECT status FROM bms_orders WHERE tenant_id = $1 AND id = $2`,
      [tenantId, firstOrder])).rows[0].status,
    "PENDING"
  );
  await query(
    `UPDATE bms_inventory SET current_stock = 100
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, DRINK, SIZE]
  );

  const second = await sendRestaurantKitchenRound({
    tenantId, locationId, deviceId, shiftId: shiftA, checkId: paidCheckId, actorUserId: waiterId,
  });
  assert.equal(second.status, "SENT");
  assert.equal((second as any).kitchenTickets, 1, "ตั๋วเดิมต้องไม่ถูกสร้างซ้ำ");
  const check = (second as any).check;
  assert.equal(check.amountDue, 2 * 60 + 15 + 3 * 15);
  assert.deepEqual(
    [...new Set(check.items.map((i: any) => i.roundNo))].sort(),
    [1, 2]
  );
  assert.equal(Number((await stock(DRINK)).reserved_stock), 4, "การจองต้องครอบทั้งบิลใหม่");

  const abandoned = (await query<{ status: string; idempotency_key: string | null }>(
    `SELECT status, idempotency_key FROM bms_orders WHERE tenant_id = $1 AND id = $2`,
    [tenantId, firstOrder]
  )).rows[0];
  assert.equal(abandoned.status, "CANCELLED");
  assert.equal(abandoned.idempotency_key, null,
    "ออร์เดอร์ที่ถูกทิ้งต้องคืนคีย์ ไม่งั้นส่งครัวที่ version เดิมชน unique index ตลอดไป");
});

test("moving a check to a free table keeps the same bill", async () => {
  const moved = await moveRestaurantCheck({
    tenantId, locationId, checkId: paidCheckId, targetTableId: tables[1].id, actorUserId: waiterId,
  });
  assert.equal(moved?.tableCode, tables[1].code);
  const floor = await listRestaurantFloor(tenantId, locationId);
  assert.equal(floor.tables.find((t) => t.id === tables[0].id)?.status, "AVAILABLE");
  assert.equal(floor.tables.find((t) => t.id === tables[1].id)?.check?.id, paidCheckId);
});

test("the register's kitchen queue is scoped to its own branch", async () => {
  const mine = await listKitchenTickets(tenantId, null, 200, locationId);
  assert.equal(mine.length, 3);
  assert.ok(mine.every((t) => t.source === "RESTAURANT_CHECK" && t.orderId === null && t.checkId));
  assert.ok(mine.some((t) => t.kitchenNote === "ไม่เผ็ด"));
  assert.ok(mine.every((t) => t.tableCode === tables[1].code), "ตั๋วต้องตามโต๊ะที่ย้ายไปแล้ว");
  assert.equal((await listKitchenTickets(tenantId, null, 200, otherLocationId)).length, 0);
  assert.equal((await listKitchenTickets(tenantId, null, 200)).length, 3, "กระดานหลังบ้านดูทั้งร้าน");
});

test("a ticket only moves for the branch that owns it", async () => {
  const ticket = (await listKitchenTickets(tenantId, "NEW", 200, locationId))[0];
  await assert.rejects(
    () => updateKitchenTicketStatus({
      tenantId, ticketId: ticket.id, status: "PREPARING",
      actorUserId: waiterId, expectedLocationId: otherLocationId,
    }),
    /ไม่พบ Kitchen ticket/
  );
  const moved = await updateKitchenTicketStatus({
    tenantId, ticketId: ticket.id, status: "PREPARING",
    actorUserId: waiterId, expectedLocationId: locationId,
  });
  assert.equal(moved.status, "PREPARING");
  assert.equal(moved.tableCode, tables[1].code);
  await assert.rejects(
    () => updateKitchenTicketStatus({
      tenantId, ticketId: ticket.id, status: "SERVED", actorUserId: waiterId,
    }),
    /เปลี่ยนสถานะ/,
    "ข้ามขั้นไม่ได้"
  );
});

/**
 * จอครัวรวมตั๋วของ (โต๊ะ + รอบ + สถานี) เป็นใบเดียว ปุ่มเดียวจึงขยับหลายแถว — ต้องเป็น
 * "ทั้งหมดหรือไม่เลื่อนเลย" ในทรานแซกชันเดียว · ถ้าปล่อยให้ครึ่งหนึ่งผ่าน งานเดียวกันจะโผล่
 * สองช่องบนกระดานพร้อมกันโดยไม่มีใครอธิบายได้ และคนครัวจะทำซ้ำหรือข้ามไปเลย
 */
test("เลื่อนทั้งใบเป็นทั้งหมดหรือไม่เลื่อนเลย", async () => {
  const stuck = (await listKitchenTickets(tenantId, "PREPARING", 200, locationId))[0];
  const fresh = await listKitchenTickets(tenantId, "NEW", 200, locationId);
  assert.ok(stuck && fresh.length >= 2, "ต้องมีทั้งใบที่ขยับแล้วและใบที่ยังใหม่ไว้ทดสอบ");

  // ใบที่ขยับไม่ได้ (PREPARING → PREPARING) ปนอยู่ในชุด = ทั้งชุดต้อง rollback
  await assert.rejects(
    () => updateKitchenTicketsStatus({
      tenantId, ticketIds: [fresh[0].id, stuck.id], status: "PREPARING",
      actorUserId: waiterId, expectedLocationId: locationId,
    }),
    /เปลี่ยนสถานะ/
  );
  const afterFailure = await listKitchenTickets(tenantId, "NEW", 200, locationId);
  assert.ok(afterFailure.some((row) => row.id === fresh[0].id),
    "ใบที่ดีต้องไม่ถูกเลื่อนทิ้งไว้ครึ่งทางเมื่อเพื่อนร่วมชุดล้ม");

  // ชุดที่ถูกต้องเลื่อนครบทุกแถวในครั้งเดียว
  const ids = fresh.slice(0, 2).map((row) => row.id);
  const moved = await updateKitchenTicketsStatus({
    tenantId, ticketIds: [...ids, ids[0]], status: "PREPARING",
    actorUserId: waiterId, expectedLocationId: locationId,
  });
  assert.equal(moved.length, ids.length, "id ซ้ำในคำขอต้องถูกยุบ ไม่ใช่เลื่อนสองรอบ");
  assert.ok(moved.every((row) => row.status === "PREPARING"));
  const stillNew = await listKitchenTickets(tenantId, "NEW", 200, locationId);
  assert.ok(ids.every((id) => !stillNew.some((row) => row.id === id)));

  // สาขาอื่นเลื่อนไม่ได้ แม้รู้ id (ด่านเดียวกับ route ทีละใบ)
  await assert.rejects(
    () => updateKitchenTicketsStatus({
      tenantId, ticketIds: [ids[0]], status: "READY",
      actorUserId: waiterId, expectedLocationId: otherLocationId,
    }),
    /ไม่พบ Kitchen ticket/
  );
  await assert.rejects(
    () => updateKitchenTicketsStatus({
      tenantId, ticketIds: [], status: "PREPARING", actorUserId: waiterId,
    }),
    /ต้องระบุตั๋ว/
  );
  await assert.rejects(
    () => updateKitchenTicketsStatus({
      tenantId, ticketIds: Array.from({ length: KITCHEN_BULK_LIMIT + 1 }, (_, i) => `id-${i}`),
      status: "PREPARING", actorUserId: waiterId,
    }),
    /สูงสุด/
  );
});

test("only NEW lines can be pulled off a check, and only from its own branch", async () => {
  const sentItemId = (await getRestaurantCheck(tenantId, paidCheckId))!.items[0].id;
  await assert.rejects(
    () => removeRestaurantCheckItem({
      tenantId, locationId, checkId: paidCheckId, actorUserId: waiterId, itemId: sentItemId,
    }),
    /ยังไม่ส่งครัว/
  );
  const other = await openRestaurantCheck({
    tenantId, locationId, deviceId, shiftId: shiftA,
    tableId: tables[2].id, guestCount: 1, actorUserId: waiterId,
  });
  await addRestaurantCheckItem({
    tenantId, locationId, checkId: other!.id, actorUserId: waiterId,
    sku: DRINK, size: SIZE, packQty: 1,
  });
  const itemId = (await getRestaurantCheck(tenantId, other!.id))!.items[0].id;
  await assert.rejects(
    () => removeRestaurantCheckItem({
      tenantId, locationId: otherLocationId, checkId: other!.id, actorUserId: waiterId, itemId,
    }),
    /ยังไม่ส่งครัว/,
    "เครื่องของสาขาอื่นต้องแก้บิลนี้ไม่ได้"
  );
  const after = await removeRestaurantCheckItem({
    tenantId, locationId, checkId: other!.id, actorUserId: waiterId, itemId,
  });
  assert.equal(after?.items.length, 0);
  await cancelRestaurantCheck({
    tenantId, locationId, checkId: other!.id, actorUserId: waiterId, reason: "เทสเก็บกวาด",
  });
});

test("⚠️ a check survives a shift change and a different cashier closing it", async () => {
  // นี่คือกรณีปกติของร้านอาหาร: เด็กเสิร์ฟเปิดโต๊ะในกะบ่าย ลูกค้าจ่ายเงินกับแคชเชียร์กะเย็น
  await query(
    `UPDATE bms_pos_shifts SET status = 'CLOSED', closed_at = now(), closed_by = $3
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, shiftA, waiterId]
  );
  shiftB = (await query<{ id: string }>(
    `INSERT INTO bms_pos_shifts (tenant_id, location_id, device_id, opened_by, opening_float)
     VALUES ($1,$2,$3,$4,0) RETURNING id`, [tenantId, locationId, deviceId, cashierId]
  )).rows[0].id;

  const due = (await getRestaurantCheck(tenantId, paidCheckId))!.amountDue;
  const result = await settleRestaurantCheck({
    tenantId, locationId, deviceId, shiftId: shiftB, checkId: paidCheckId,
    actorUserId: cashierId,
    payments: [{ method: "CASH", amount: due, cashTendered: due }],
  });
  assert.equal(result.status, "SOLD", `คิดเงินต้องผ่าน แต่ได้ ${JSON.stringify(result)}`);
  assert.equal((result as any).total, due);

  const order = (await query<{ status: string; pos_shift_id: string; cashier_user_id: string; restaurant_check_id: string }>(
    `SELECT status, pos_shift_id, cashier_user_id, restaurant_check_id FROM bms_orders
      WHERE tenant_id = $1 AND id = $2`, [tenantId, (result as any).orderId]
  )).rows[0];
  assert.equal(order.pos_shift_id, shiftB, "ยอดขายต้องเป็นของกะที่รับเงินจริง");
  assert.equal(order.cashier_user_id, cashierId);
  assert.equal(order.restaurant_check_id, paidCheckId);

  const check = await getRestaurantCheck(tenantId, paidCheckId);
  assert.equal(check?.status, "PAID");
  const settlementState = (await query<{
    settlement_attempt_id: string | null;
    settlement_started_at: Date | null;
    paid_audits: string;
  }>(
    `SELECT c.settlement_attempt_id, c.settlement_started_at,
            (SELECT count(*)::text FROM bms_audit_log a
              WHERE a.tenant_id = c.tenant_id AND a.target = c.id::text
                AND a.action = 'restaurant.check_paid') AS paid_audits
       FROM bms_restaurant_checks c
      WHERE c.tenant_id = $1 AND c.id = $2`,
    [tenantId, paidCheckId]
  )).rows[0];
  assert.equal(settlementState.settlement_attempt_id, null);
  assert.equal(settlementState.settlement_started_at, null);
  assert.equal(Number(settlementState.paid_audits), 1,
    "check-paid audit ต้อง commit พร้อม POS sale ไม่ใช่งานตามหลัง");
  assert.equal(Number((await stock(FOOD)).current_stock), 98, "จบบิลแล้วต้องตัดสต็อกจริง");
  assert.equal(Number((await stock(FOOD)).reserved_stock), 0);
  assert.equal(Number((await stock(DRINK)).current_stock), 96);
  assert.equal(Number((await stock(DRINK)).reserved_stock), 0);

  const floor = await listRestaurantFloor(tenantId, locationId);
  assert.equal(floor.tables.find((t) => t.id === tables[1].id)?.status, "AVAILABLE");
});

test("settlement never enqueues a second copy of the dine-in tickets", async () => {
  const retail = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms_kitchen_tickets WHERE tenant_id = $1`, [tenantId]
  );
  assert.equal(Number(retail.rows[0].n), 0, "ตั๋วของบิลโต๊ะต้องไม่ถูกสร้างซ้ำตอนปิดการขาย");
  assert.equal(
    Number((await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM bms_restaurant_kitchen_tickets WHERE tenant_id = $1`,
      [tenantId])).rows[0].n),
    3
  );
});

test("a paid check cannot be cancelled, and a stuck CLOSING one always can", async () => {
  await assert.rejects(
    () => cancelRestaurantCheck({
      tenantId, locationId, checkId: paidCheckId, actorUserId: cashierId, reason: "ไม่ควรได้",
    }),
    /ยกเลิกไม่ได้/
  );

  const fresh = await openRestaurantCheck({
    tenantId, locationId, deviceId, shiftId: shiftB,
    tableId: tables[3].id, guestCount: 4, actorUserId: cashierId,
  });
  await addRestaurantCheckItem({
    tenantId, locationId, checkId: fresh!.id, actorUserId: cashierId,
    sku: FOOD, size: SIZE, packQty: 1,
  });
  await sendRestaurantKitchenRound({
    tenantId, locationId, deviceId, shiftId: shiftB, checkId: fresh!.id, actorUserId: cashierId,
  });
  assert.equal(Number((await stock(FOOD)).reserved_stock), 1);

  // จำลองการเก็บเงินที่ล้มกลางทางจนบิลค้างที่ CLOSING (โปรเซสตาย/เน็ตหลุด)
  await query(
    `UPDATE bms_restaurant_checks
        SET status = 'CLOSING', settlement_attempt_id = gen_random_uuid(),
            settlement_started_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, fresh!.id]
  );
  await assert.rejects(
    () => cancelRestaurantCheck({
      tenantId, locationId, checkId: fresh!.id, actorUserId: cashierId, reason: "ห้ามชน payment",
    }),
    /กำลังรับชำระ/,
    "active settlement lease ต้องกันอีกเครื่องยกเลิกบิลกลางการรับเงิน"
  );
  await query(
    `UPDATE bms_restaurant_checks SET settlement_started_at = now() - interval '6 minutes'
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, fresh!.id]
  );
  await assert.rejects(
    () => cancelRestaurantCheck({
      tenantId, locationId, checkId: fresh!.id, actorUserId: cashierId, reason: "ไม่มีหัวหน้า",
    }),
    /คนที่สอง/,
    "บิลที่ส่งครัวแล้วต้องปฏิเสธแม้ lease หมด ถ้าไม่มีหลักฐานผู้อนุมัติ"
  );
  await assert.rejects(
    () => cancelRestaurantCheck({
      tenantId, locationId, checkId: fresh!.id, actorUserId: cashierId,
      approvedByUserId: cashierId, reason: "อนุมัติตัวเอง",
    }),
    /คนที่สอง/,
    "ผู้ปฏิบัติงานอนุมัติ void ให้ตัวเองไม่ได้"
  );
  const cancelled = await cancelRestaurantCheck({
    tenantId, locationId, checkId: fresh!.id, actorUserId: cashierId,
    approvedByUserId: waiterId, reason: "ลูกค้าเดินออก",
  });
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(Number((await stock(FOOD)).reserved_stock), 0, "ยกเลิกต้องปล่อยของคืนชั้น");
  assert.equal(Number((await stock(FOOD)).current_stock), 98, "ยกเลิกไม่ใช่การขาย");
  const tickets = await listKitchenTickets(tenantId, "CANCELLED", 200, locationId);
  assert.ok(tickets.length >= 1, "ตั๋วของบิลที่ยกเลิกต้องหยุด ไม่ใช่ให้ครัวทำต่อ");
  const cancelAudit = (await query<{ meta: { approvedByUserId?: string | null } }>(
    `SELECT meta FROM bms_audit_log
      WHERE tenant_id = $1 AND action = 'restaurant.check_cancel' AND target = $2
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, fresh!.id]
  )).rows[0];
  assert.equal(cancelAudit.meta.approvedByUserId, waiterId,
    "audit ต้องระบุคนที่สองซึ่งอนุมัติการยกเลิกอาหารที่ส่งครัวแล้ว");
  assert.equal(
    (await listRestaurantFloor(tenantId, locationId)).tables.find((t) => t.id === tables[3].id)?.status,
    "AVAILABLE"
  );
});

test("ย้อนสถานะได้ทีละขั้น แต่ใบที่ยกเลิกแล้วย้อนไม่ได้", async () => {
  const ticket = (await listKitchenTickets(tenantId, "PREPARING", 200, locationId))[0];
  assert.ok(ticket, "ต้องมีใบที่กำลังทำอยู่");
  const back = await updateKitchenTicketStatus({
    tenantId, ticketId: ticket.id, status: "NEW",
    actorUserId: waiterId, expectedLocationId: locationId,
  });
  assert.equal(back.status, "NEW", "กดผิดแล้วต้องถอยได้");

  // ข้ามขั้นถอยสองทียังไม่ได้เหมือนเดิม
  await assert.rejects(
    () => updateKitchenTicketStatus({
      tenantId, ticketId: ticket.id, status: "SERVED",
      actorUserId: waiterId, expectedLocationId: locationId,
    }),
    /เปลี่ยนสถานะ/
  );

  // ยกเลิกแล้วเป็นปลายทางถาวร — บรรทัดหลุดจากบิลไปแล้ว การย้อนคือการแก้บิล
  await updateKitchenTicketStatus({
    tenantId, ticketId: ticket.id, status: "CANCELLED",
    actorUserId: waiterId, expectedLocationId: locationId,
    onRestaurantCheckLineCancelled: dropKitchenCancelledLineInTx,
  });
  await assert.rejects(
    () => updateKitchenTicketStatus({
      tenantId, ticketId: ticket.id, status: "NEW",
      actorUserId: waiterId, expectedLocationId: locationId,
    }),
    /เปลี่ยนสถานะ/
  );
});

test("เกณฑ์เวลาต่อสถานีเก็บได้ ลบแล้วกลับไปใช้ค่าปริยาย และค่าที่ผิดถูกปฏิเสธ", async () => {
  await upsertKitchenStationSla(tenantId, { station: "บาร์เครื่องดื่ม", warnMinutes: 2, lateMinutes: 4 }, waiterId);
  const map = await getKitchenStationSlaMap(tenantId);
  assert.deepEqual(map["บาร์เครื่องดื่ม"], { warnMinutes: 2, lateMinutes: 4 });

  // เหลืองต้องมาก่อนแดง ไม่งั้นใบกระโดดเป็นแดงโดยไม่มีขั้นเตือน
  await assert.rejects(
    () => upsertKitchenStationSla(tenantId, { station: "บาร์เครื่องดื่ม", warnMinutes: 9, lateMinutes: 3 }, waiterId),
    /น้อยกว่า/
  );
  await assert.rejects(
    () => upsertKitchenStationSla(tenantId, { station: "บาร์เครื่องดื่ม", warnMinutes: 1, lateMinutes: 900 }, waiterId),
    /0 ถึง 600/
  );
  await assert.rejects(
    () => upsertKitchenStationSla(tenantId, { station: "   ", warnMinutes: 1, lateMinutes: 2 }, waiterId),
    /ชื่อสถานี/
  );

  // แก้ค่าเดิมทับได้ (ไม่ใช่สร้างแถวที่สอง)
  await upsertKitchenStationSla(tenantId, { station: "บาร์เครื่องดื่ม", warnMinutes: 3, lateMinutes: 6 }, waiterId);
  assert.deepEqual((await getKitchenStationSlaMap(tenantId))["บาร์เครื่องดื่ม"], { warnMinutes: 3, lateMinutes: 6 });

  // หน้าตั้งค่าเห็นสถานีที่ยังไม่เคยตั้งด้วย ไม่งั้นร้านต้องเดาชื่อให้ตรงเป๊ะเอง
  const listed = await listKitchenStationSlas(tenantId);
  const bar = listed.find((row) => row.station === "บาร์เครื่องดื่ม");
  assert.equal(bar?.configured, true);
  assert.ok(listed.every((row) => row.warnMinutes < row.lateMinutes));

  assert.equal(await clearKitchenStationSla(tenantId, "บาร์เครื่องดื่ม", waiterId), true);
  assert.equal((await getKitchenStationSlaMap(tenantId))["บาร์เครื่องดื่ม"], undefined);
  assert.equal(await clearKitchenStationSla(tenantId, "บาร์เครื่องดื่ม", waiterId), false, "ลบซ้ำต้องไม่ล้ม");
});

/**
 * ⚠️ เคสจริงจาก production (2026-09-05): โต๊ะที่นั่งกินเกิน 30 นาทีถูก cron ปล่อยบิลหมดอายุ
 * ยกเลิกใบจองทิ้ง แล้วโต๊ะนั้นทั้งส่งครัวและคิดเงินไม่ได้อีกเลย โดยหน้าจอขึ้นแค่
 * "เซิร์ฟเวอร์ผิดพลาด" · ใบจองของบิลโต๊ะไม่หมดอายุตามเวลา — มันจบเมื่อคิดเงินหรือยกเลิกบิล
 */
test("cron ปล่อยบิลหมดอายุต้องไม่แตะใบจองของโต๊ะ แต่ยังปล่อยบิลออนไลน์ตามเดิม", async () => {
  const table = tables[2];
  const check = await openRestaurantCheck({
    tenantId, locationId, deviceId, shiftId: shiftB, tableId: table.id, guestCount: 2,
    actorUserId: cashierId,
  });
  await addRestaurantCheckItem({
    tenantId, locationId, checkId: check.id, actorUserId: cashierId,
    sku: FOOD, size: SIZE, packQty: 1,
  });
  const sent = await sendRestaurantKitchenRound({
    tenantId, locationId, deviceId, shiftId: shiftB, checkId: check.id, actorUserId: cashierId,
  });
  assert.equal(sent.status, "SENT");
  const reservationId = (await query<{ id: string }>(
    `SELECT current_order_id AS id FROM bms_restaurant_checks WHERE tenant_id = $1 AND id = $2`,
    [tenantId, check.id])).rows[0].id;

  // ลูกค้านั่งกินสองชั่วโมง — เวลาเดียวที่ cron ใช้ตัดสิน
  await query(`UPDATE bms_orders SET created_at = now() - interval '2 hours' WHERE id = $1`, [reservationId]);
  // บิลออนไลน์เก่าในร้านเดียวกัน เพื่อพิสูจน์ว่า job ยังทำงาน ไม่ใช่ถูกปิดไปทั้งตัว
  const abandoned = (await query<{ id: string }>(
    `INSERT INTO bms_orders (tenant_id, location_id, channel, status, total_amount, created_at)
     VALUES ($1,$2,'web','PENDING',0, now() - interval '2 hours') RETURNING id`,
    [tenantId, locationId])).rows[0].id;

  const result = await releaseExpiredOrders(30, tenantId);
  assert.deepEqual(result.failed, []);
  assert.ok(result.orderIds.includes(abandoned), "บิลออนไลน์ที่ถูกทิ้งต้องยังถูกปล่อยเหมือนเดิม");
  assert.ok(!result.orderIds.includes(reservationId), "ใบจองของโต๊ะที่ยังนั่งอยู่ต้องไม่ถูกแตะ");

  assert.equal(
    (await query<{ status: string }>(`SELECT status FROM bms_orders WHERE id = $1`, [reservationId])).rows[0].status,
    "PENDING"
  );
  assert.equal(Number((await stock(FOOD)).reserved_stock), 1, "อาหารที่ครัวทำไปแล้วต้องยังถูกจองอยู่");
  const alive = await getRestaurantCheck(tenantId, check.id);
  assert.equal(alive?.reservationLost, false);
  await cancelRestaurantCheck({
    tenantId, locationId, checkId: check.id, actorUserId: cashierId,
    reason: "ปิดหลังเทส", approvedByUserId: waiterId,
  });
});

/**
 * ใบจองอาจหายได้จากทางอื่นอีก (คนไปยกเลิกออร์เดอร์จากหลังบ้าน, สคริปต์ซ่อมข้อมูล) การกัน
 * cron อย่างเดียวจึงไม่พอ — โต๊ะต้อง "กู้เองได้" ด้วยการส่งครัวอีกครั้ง ไม่ใช่เป็นทางตัน
 */
test("ใบจองที่หายไปกู้ได้ด้วยการส่งครัวอีกครั้ง แล้วคิดเงินได้ตามปกติ", async () => {
  const table = tables[3];
  const check = await openRestaurantCheck({
    tenantId, locationId, deviceId, shiftId: shiftB, tableId: table.id, guestCount: 1,
    actorUserId: cashierId,
  });
  await addRestaurantCheckItem({
    tenantId, locationId, checkId: check.id, actorUserId: cashierId,
    sku: DRINK, size: SIZE, packQty: 2,
  });
  const sent = await sendRestaurantKitchenRound({
    tenantId, locationId, deviceId, shiftId: shiftB, checkId: check.id, actorUserId: cashierId,
  });
  assert.equal(sent.status, "SENT");
  const lostOrder = (await query<{ id: string }>(
    `SELECT current_order_id AS id FROM bms_restaurant_checks WHERE tenant_id = $1 AND id = $2`,
    [tenantId, check.id])).rows[0].id;
  const drinkBefore = Number((await stock(DRINK)).reserved_stock);

  // ยกเลิกใบจองจากนอกเส้นทางของบิลโต๊ะ = สภาพที่ production เจอ
  assert.equal(await cancelOrder(tenantId, lostOrder), true);
  assert.equal(Number((await stock(DRINK)).reserved_stock), drinkBefore - 2, "ของถูกปล่อยคืนไปแล้วจริง");

  const broken = await getRestaurantCheck(tenantId, check.id);
  assert.equal(broken?.reservationLost, true, "จอต้องรู้ได้ก่อนกดปุ่ม ไม่ใช่รู้ตอนล้ม");
  assert.equal(broken?.reservationStatus, "CANCELLED");

  // คิดเงินตอนนี้ต้องบอกทางไปต่อ ไม่ใช่ 500 ที่อ่านไม่รู้เรื่อง
  await assert.rejects(
    () => settleRestaurantCheck({
      tenantId, locationId, deviceId, shiftId: shiftB, checkId: check.id,
      actorUserId: cashierId, payments: [{ method: "CASH", amount: 30, cashTendered: 30 }],
    }),
    (error: any) => {
      assert.equal(error.code, RESERVATION_LOST);
      assert.match(error.message, /ส่งครัวอีกครั้ง/);
      return true;
    }
  );

  const ticketsBefore = Number((await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms_restaurant_kitchen_tickets t
       JOIN bms_restaurant_check_items i ON i.tenant_id = t.tenant_id AND i.id = t.check_item_id
      WHERE t.tenant_id = $1 AND i.check_id = $2`, [tenantId, check.id])).rows[0].n);

  const recovered = await sendRestaurantKitchenRound({
    tenantId, locationId, deviceId, shiftId: shiftB, checkId: check.id, actorUserId: cashierId,
  });
  assert.equal(recovered.status, "SENT", `กู้ต้องผ่าน แต่ได้ ${JSON.stringify(recovered)}`);
  assert.equal((recovered as any).kitchenTickets, 0, "ครัวต้องไม่ได้รายการซ้ำจากการกู้");
  assert.equal(Number((await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms_restaurant_kitchen_tickets t
       JOIN bms_restaurant_check_items i ON i.tenant_id = t.tenant_id AND i.id = t.check_item_id
      WHERE t.tenant_id = $1 AND i.check_id = $2`, [tenantId, check.id])).rows[0].n), ticketsBefore);
  assert.equal(Number((await stock(DRINK)).reserved_stock), drinkBefore, "ของต้องถูกจองคืนให้ครบ");

  const fixed = await getRestaurantCheck(tenantId, check.id);
  assert.equal(fixed?.reservationLost, false);
  const due = fixed!.amountDue;
  const paid = await settleRestaurantCheck({
    tenantId, locationId, deviceId, shiftId: shiftB, checkId: check.id,
    actorUserId: cashierId, payments: [{ method: "CASH", amount: due, cashTendered: due }],
  });
  assert.equal(paid.status, "SOLD", `หลังกู้ต้องคิดเงินได้ แต่ได้ ${JSON.stringify(paid)}`);
});

test("teardown: drop the throwaway tenant and everything under it", async () => {
  const stale = await query<{ id: string }>(
    `SELECT id FROM bms_tenants WHERE slug LIKE $1`, [`fake-${TAG}-%`]
  );
  const ids = [...new Set([tenantId, ...stale.rows.map((r) => r.id)].filter(Boolean))];
  if (ids.length === 0) return;
  // bms_orders.restaurant_check_id และ bms_restaurant_checks.current_order_id ชี้กันไปกลับ
  // ต้องตัดขาหนึ่งก่อน ไม่งั้นลบอะไรก่อนก็ชน FK (teardown ที่ throw = teardown ที่ไม่มีใครรู้ว่าไม่ทำงาน)
  await query(
    `UPDATE bms_restaurant_checks SET current_order_id = NULL WHERE tenant_id = ANY($1::uuid[])`,
    [ids]
  );
  for (const table of [
    "bms_restaurant_kitchen_tickets",
    "bms_restaurant_check_items",
    // checks ต้องไปหลัง orders เพราะ bms_orders.restaurant_check_id เป็น FK ปกติ (NO ACTION)
    "bms_kitchen_station_slas", "bms_kitchen_tickets",
    "bms_payments",
    "bms_order_items",
    "bms_order_discounts",
    "bms_tax_documents",
    "bms_pos_cash_movements",
    "bms_orders",
    "bms_restaurant_checks",
    "bms_restaurant_tables",
    "bms_restaurant_areas",
    "bms_pos_shifts",
    "bms_pos_devices",
    "bms_stock_movements",
    "bms_inventory",
    "bms_products",
    "bms_store_profile",
    "bms_locations",
    "bms_audit_log",
    "users",
  ]) {
    await query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [ids]);
  }
  await query(`DELETE FROM bms_tenants WHERE id = ANY($1::uuid[])`, [ids]);
  assert.equal(
    Number((await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM bms_tenants WHERE id = ANY($1::uuid[])`, [ids])).rows[0].n),
    0,
    "ร้านทดสอบต้องไม่เหลือค้างในฐาน"
  );
});
