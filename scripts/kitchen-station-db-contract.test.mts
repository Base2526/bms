/**
 * Kitchen station master (`9.54`) against a real Postgres.
 *
 * ก่อน `9.54` สถานีครัวมีอยู่แค่เป็นสตริงบน `bms_product_stock_policies.kitchen_station`
 * ทุกอย่างที่อ้างถึงสถานีจึงอ้างด้วย "ชื่อที่พิมพ์ตรงกันเป๊ะ" · ชุดนี้ตรึงสิ่งที่แตกได้เงียบที่สุด
 * เมื่อสถานีกลายเป็น entity:
 *
 *  - **ตั๋วต้องถือทั้ง id และชื่อ ณ เวลาที่ครัวเห็น** — เปลี่ยนชื่อสถานีวันนี้ต้องไม่เขียนประวัติ
 *    ของเมื่อวานใหม่ แต่ใบที่ยังทำอยู่ต้องยังตกอยู่ใต้ตัวกรองและเกณฑ์เวลาของครัวเดิม
 *  - **สถานีเฉพาะสาขาต้องไม่ข้ามสาขา** — บิลของสาขาอื่นที่ขายเมนูเดียวกันต้องได้ "ไม่ระบุสถานี"
 *    ไม่ใช่ตั๋วที่ถูกส่งไปครัวซึ่งสาขานั้นไม่มีอยู่จริง (อาหารที่ไม่มีใครทำโดยไม่มีใครรู้)
 *  - **ปิดสถานีคือ active = FALSE ไม่ใช่ลบ** — และสถานีที่ปิดแล้วยังรับตั๋วได้ เพราะการทำให้
 *    อาหารหายจากกระดานเพราะการตั้งค่า แย่กว่าการมีตั๋วบนสถานีที่กำลังจะเลิกใช้
 *  - **ชื่อที่มาทางเส้นทางเก่า (ไฟล์นำเข้า/ฟอร์มสินค้า) ต้องถูกยกขึ้นเป็นแถวหลัก** ไม่งั้นสถานี
 *    กำพร้าที่ตั้งเกณฑ์เวลาไม่ได้จะงอกขึ้นเรื่อย ๆ ซึ่งคืออาการที่ `9.54` ทำมาเพื่อเลิก
 *
 * ⚠️ เขียนจริงลงฐาน — สร้าง tenant ของตัวเองแล้วลบทิ้ง **ห้ามรันกับ production**
 * (ตั้ง `business_archetype = 'restaurant'` ซึ่งเปลี่ยนพฤติกรรมของทุกบิลในร้านนั้น)
 *
 * รันจาก apps/web:
 *   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
 *   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
 *     --test --test-concurrency=1 --test-force-exit \
 *     ../../scripts/kitchen-station-db-contract.test.mts
 */
import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import {
  archiveKitchenStation,
  createKitchenStation,
  ensureKitchenStationByNameInTx,
  getKitchenStation,
  listKitchenStations,
  listUnmappedKitchenStationNames,
  updateKitchenStation,
} from "../apps/web/lib/bms/kitchenStations.ts";
import { upsertProductStockPolicy } from "../apps/web/lib/bms/productStockPolicies.ts";
import { getKitchenStationSlaMap, upsertKitchenStationSla } from "../apps/web/lib/bms/kitchenSla.ts";
import { listKitchenTickets } from "../apps/web/lib/bms/kitchen.ts";
import {
  addRestaurantCheckItem,
  createDefaultRestaurantFloor,
  openRestaurantCheck,
  sendRestaurantKitchenRound,
} from "../apps/web/lib/bms/restaurantPos.ts";
import { getProductReadiness } from "../apps/web/lib/bms/productConfiguration.ts";

const TAG = "kitchen-station-test";
const SIZE = "BASE";
const FOOD = `FAKE-${TAG}-PADTHAI`;
const DRINK = `FAKE-${TAG}-TEA`;

let tenantId = "";
let locationId = "";
let otherLocationId = "";
let deviceId = "";
let shiftId = "";
let actorId = "";
let hotStationId = "";
let barStationId = "";
let branchStationId = "";
let tables: Array<{ id: string; code: string }> = [];

const ALL_SURFACES = ["RETAIL_POS", "RESTAURANT_POS", "ONLINE_ORDER", "PUBLIC_STOREFRONT", "CUSTOMER_AI"];

async function declareSalesSurfaces(sku: string) {
  for (const surface of ALL_SURFACES) {
    await query(
      `INSERT INTO bms_product_sales_surfaces (tenant_id, product_sku, surface)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [tenantId, sku, surface]
    );
  }
}

test("setup: ร้านอาหารชั่วคราวพร้อมสองสาขา เครื่องขาย กะที่เปิดอยู่ และเมนูสองจาน", async () => {
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
  for (const [sku, price] of [[FOOD, 60], [DRINK, 25]] as const) {
    await query(
      `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category)
       VALUES ($1,$2,$2,$3,TRUE,'V')`, [tenantId, sku, price]
    );
    await query(
      `INSERT INTO bms_product_variants (tenant_id, product_sku, code, sort_order, active)
       VALUES ($1,$2,$3,0,TRUE) ON CONFLICT DO NOTHING`, [tenantId, sku, SIZE]
    );
    await query(
      `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
       VALUES ($1,$2,$3,$4,100,0)`, [tenantId, locationId, sku, SIZE]
    );
    await declareSalesSurfaces(sku);
  }
  actorId = (await query<{ id: string }>(
    `INSERT INTO users (name, username, email, role, role_id, tenant_id, password_hash, fake_test)
     SELECT $2, $3, $3, 'Administrator', r.id, $1, 'x', TRUE
       FROM roles r WHERE r.name = 'Administrator' LIMIT 1
     RETURNING id`,
    [tenantId, `FAKE ${TAG} staff`, `fake-${TAG}-${Date.now()}@example.invalid`]
  )).rows[0].id;
  deviceId = (await query<{ id: string }>(
    `INSERT INTO bms_pos_devices (tenant_id, location_id, code, name)
     VALUES ($1,$2,'POS-1',$3) RETURNING id`, [tenantId, locationId, `FAKE ${TAG} device`]
  )).rows[0].id;
  shiftId = (await query<{ id: string }>(
    `INSERT INTO bms_pos_shifts (tenant_id, location_id, device_id, opened_by, opening_float)
     VALUES ($1,$2,$3,$4,0) RETURNING id`, [tenantId, locationId, deviceId, actorId]
  )).rows[0].id;
  const floor = await createDefaultRestaurantFloor({
    tenantId, locationId, actorUserId: actorId, tableCount: 4,
  });
  tables = floor.tables.map((t) => ({ id: t.id, code: t.code }));
});

test("สร้างสถานี: รหัส derive จากชื่อ และชื่อไทยไม่ถูกบดทิ้ง", async () => {
  const hot = await createKitchenStation(tenantId, { name: "ครัวร้อน", sortOrder: 1 }, actorId);
  const bar = await createKitchenStation(tenantId, { name: "บาร์ เครื่องดื่ม", sortOrder: 0 }, actorId);
  hotStationId = hot.id;
  barStationId = bar.id;
  assert.equal(hot.code, "ครัวร้อน", "สระ/วรรณยุกต์ไทยต้องอยู่ครบในรหัส");
  assert.equal(bar.code, "บาร์_เครื่องดื่ม");
  assert.equal(hot.locationId, null, "สถานีใหม่เป็นระดับร้านโดยปริยาย");
  // audit ต้องอยู่ในทรานแซกชันเดียวกับการเขียน
  const audits = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_audit_log
      WHERE tenant_id = $1 AND action = 'kitchen.station_create'`, [tenantId]
  );
  assert.equal(Number(audits.rows[0].n), 2);
});

test("ชื่อซ้ำและรหัสซ้ำถูกปฏิเสธด้วยข้อความที่คนตั้งค่าอ่านรู้เรื่อง", async () => {
  // ชื่อซ้ำทำให้ "ชื่อ → เกณฑ์เวลา" มีสองคำตอบ ซึ่งเป็นเหตุผลทั้งหมดที่ดัชนีนั้นมีอยู่
  await assert.rejects(
    () => createKitchenStation(tenantId, { name: "ครัวร้อน" }, actorId),
    /มีสถานีชื่อนี้อยู่แล้ว/
  );
  await assert.rejects(
    () => createKitchenStation(tenantId, { name: "ครัวร้อนสำรอง", code: "ครัวร้อน" }, actorId),
    /ใช้รหัสนี้อยู่แล้ว/
  );
});

test("สาขาของสถานีต้องเป็นสาขาของร้านนี้ — id จาก body ไม่ได้แปลว่าเชื่อ id จาก body", async () => {
  const outsider = (await query<{ id: string }>(
    `INSERT INTO bms_tenants (name, slug) VALUES ($1,$2) RETURNING id`,
    [`FAKE ${TAG} outsider`, `fake-${TAG}-outsider-${Date.now()}`]
  )).rows[0].id;
  const foreignLocation = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name, branch_code)
     VALUES ($1,'MAIN',$2,'00000') RETURNING id`, [outsider, `FAKE ${TAG} outsider branch`]
  )).rows[0].id;
  await assert.rejects(
    () => createKitchenStation(tenantId, { name: "ครัวข้ามร้าน", locationId: foreignLocation }, actorId),
    /ไม่พบสาขานี้ในร้าน/
  );
  const branch = await createKitchenStation(
    tenantId, { name: "ครัวสาขาสอง", locationId: otherLocationId, sortOrder: 5 }, actorId
  );
  branchStationId = branch.id;
  assert.equal(branch.locationId, otherLocationId);
});

test("รายการสถานีของสาขาหนึ่ง = สถานีระดับร้าน + สถานีของสาขานั้น", async () => {
  // ไม่ใช่ `location_id = $2` ตรง ๆ — ไม่งั้นสาขาที่ยังไม่มีครัวของตัวเองจะไม่มีสถานีให้เลือกเลย
  const atMain = await listKitchenStations(tenantId, { locationId });
  assert.deepEqual(atMain.map((s) => s.name), ["บาร์ เครื่องดื่ม", "ครัวร้อน"]);
  const atBranch = await listKitchenStations(tenantId, { locationId: otherLocationId });
  assert.deepEqual(atBranch.map((s) => s.name), ["บาร์ เครื่องดื่ม", "ครัวร้อน", "ครัวสาขาสอง"]);
});

test("ผูกเมนูกับสถานี: ชื่อบน stock policy เป็นค่าที่ derive ไม่ใช่ค่าที่ผู้เรียกตั้งเอง", async () => {
  const saved = await upsertProductStockPolicy(
    tenantId,
    // ส่งชื่อที่ขัดกับ id มาด้วยโดยตั้งใจ — id ต้องชนะเสมอ ไม่งั้นสินค้าชี้สถานี A
    // แต่ป้ายบนจอครัวเขียนว่า B แล้วไม่มีทางรู้ว่าอันไหนคือความจริง
    { productSku: FOOD, kitchenStationId: hotStationId, kitchenStation: "ชื่อมั่ว" },
    actorId
  );
  assert.equal(saved.kitchenStationId, hotStationId);
  assert.equal(saved.kitchenStation, "ครัวร้อน");
  await upsertProductStockPolicy(tenantId, { productSku: DRINK, kitchenStationId: barStationId }, actorId);
  await assert.rejects(
    () => upsertProductStockPolicy(
      tenantId, { productSku: FOOD, kitchenStationId: "00000000-0000-0000-0000-000000000000" }, actorId
    ),
    /ไม่พบสถานีครัวนี้ในร้าน/
  );
});

test("ล้างสถานีต้องล้างชื่อไปด้วย ไม่ทิ้งสตริงกำพร้าไว้", async () => {
  const cleared = await upsertProductStockPolicy(
    tenantId, { productSku: DRINK, kitchenStationId: null }, actorId
  );
  assert.equal(cleared.kitchenStationId, null);
  assert.equal(cleared.kitchenStation, null);
  await upsertProductStockPolicy(tenantId, { productSku: DRINK, kitchenStationId: barStationId }, actorId);
});

test("ชื่อล้วนจากเส้นทางเก่าถูกยกขึ้นเป็นแถวหลักอัตโนมัติ", async () => {
  // ไฟล์นำเข้าส่งชื่อมาอย่างเดียว · ถ้าไม่ยกขึ้นเป็นแถวหลัก สถานีนั้นจะไม่โผล่ในดรอปดาวน์
  // เปิด/ปิดไม่ได้ และเรียงลำดับไม่ได้
  const saved = await upsertProductStockPolicy(
    tenantId, { productSku: DRINK, kitchenStation: "ครัวเย็น" }, actorId
  );
  assert.equal(saved.kitchenStation, "ครัวเย็น");
  assert.notEqual(saved.kitchenStationId, null);
  const stations = await listKitchenStations(tenantId, {});
  assert.equal(stations.some((s) => s.name === "ครัวเย็น"), true);
  assert.deepEqual(await listUnmappedKitchenStationNames(tenantId), [], "ต้องไม่มีสถานีกำพร้าเหลือ");
  await upsertProductStockPolicy(tenantId, { productSku: DRINK, kitchenStationId: barStationId }, actorId);
});

test("จำนวนเมนูที่ผูกอยู่นับจาก id ไม่ใช่จากชื่อ", async () => {
  const [hot] = (await listKitchenStations(tenantId, {})).filter((s) => s.id === hotStationId);
  assert.equal(hot.productCount, 1);
  assert.equal(hot.activeProductCount, 1);
});

test("ส่งครัว: ตั๋วเก็บทั้ง station_id และชื่อ ณ เวลาที่ครัวเห็น", async () => {
  const check = await openRestaurantCheck({
    tenantId, locationId, tableId: tables[0].id, deviceId, shiftId, actorUserId: actorId, guestCount: 2,
  });
  await addRestaurantCheckItem({
    tenantId, locationId, checkId: check.id, sku: FOOD, size: SIZE, packQty: 1, actorUserId: actorId,
  });
  await addRestaurantCheckItem({
    tenantId, locationId, checkId: check.id, sku: DRINK, size: SIZE, packQty: 2, actorUserId: actorId,
  });
  const sent = await sendRestaurantKitchenRound({
    tenantId, locationId, checkId: check.id, deviceId, shiftId, actorUserId: actorId,
  });
  assert.equal(sent.status, "SENT");
  const rows = await query<{ station: string | null; station_id: string | null; product_sku: string }>(
    `SELECT rt.station, rt.station_id, ci.product_sku
       FROM bms_restaurant_kitchen_tickets rt
       JOIN bms_restaurant_check_items ci ON ci.tenant_id = rt.tenant_id AND ci.id = rt.check_item_id
      WHERE rt.tenant_id = $1 AND rt.check_id = $2
      ORDER BY ci.product_sku`,
    [tenantId, check.id]
  );
  assert.equal(rows.rows.length, 2);
  const food = rows.rows.find((r) => r.product_sku === FOOD)!;
  assert.equal(food.station_id, hotStationId);
  assert.equal(food.station, "ครัวร้อน");
});

test("เปลี่ยนชื่อสถานี: ประวัติไม่เปลี่ยน แต่เกณฑ์เวลาและสตริง fallback ตามไป", async () => {
  await upsertKitchenStationSla(tenantId, { station: "ครัวร้อน", warnMinutes: 8, lateMinutes: 12 }, actorId);
  await updateKitchenStation(tenantId, hotStationId, { name: "ครัวร้อน (ใหม่)" }, actorId);

  // ตั๋วที่ออกไปแล้วถือชื่อเดิม — คือสิ่งที่ครัวเห็นจริงตอนทำอาหาร
  const ticketNames = await query<{ station: string | null }>(
    `SELECT station FROM bms_restaurant_kitchen_tickets
      WHERE tenant_id = $1 AND station_id = $2`, [tenantId, hotStationId]
  );
  assert.equal(ticketNames.rows.every((r) => r.station === "ครัวร้อน"), true);

  // เกณฑ์เวลาย้ายคีย์ตามชื่อใหม่ ไม่ปล่อยให้กลายเป็นแถวกำพร้าแล้วสถานีตกกลับค่าปริยาย 5/10
  const map = await getKitchenStationSlaMap(tenantId);
  assert.deepEqual(map["ครัวร้อน (ใหม่)"], { warnMinutes: 8, lateMinutes: 12 });
  // แมพต้องคีย์ด้วย id ด้วย — ใบเก่าที่ถือชื่อเดิมจึงยังหาเกณฑ์ของครัวเดิมเจอ
  assert.deepEqual(map[hotStationId], { warnMinutes: 8, lateMinutes: 12 });

  const policy = await query<{ kitchen_station: string | null }>(
    `SELECT kitchen_station FROM bms_product_stock_policies
      WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, FOOD]
  );
  assert.equal(policy.rows[0].kitchen_station, "ครัวร้อน (ใหม่)");
});

test("สถานีเฉพาะสาขาไม่ข้ามสาขา — บิลของสาขาอื่นได้ 'ไม่ระบุสถานี'", async () => {
  // ส่งไปครัวที่สาขานั้นไม่มีอยู่จริง = อาหารจานนั้นไม่มีใครทำโดยไม่มีใครรู้
  await upsertProductStockPolicy(tenantId, { productSku: FOOD, kitchenStationId: branchStationId }, actorId);
  const check = await openRestaurantCheck({
    tenantId, locationId, tableId: tables[1].id, deviceId, shiftId, actorUserId: actorId, guestCount: 1,
  });
  await addRestaurantCheckItem({
    tenantId, locationId, checkId: check.id, sku: FOOD, size: SIZE, packQty: 1, actorUserId: actorId,
  });
  await sendRestaurantKitchenRound({
    tenantId, locationId, checkId: check.id, deviceId, shiftId, actorUserId: actorId,
  });
  const row = (await query<{ station: string | null; station_id: string | null }>(
    `SELECT rt.station, rt.station_id FROM bms_restaurant_kitchen_tickets rt
      WHERE rt.tenant_id = $1 AND rt.check_id = $2`, [tenantId, check.id]
  )).rows[0];
  assert.equal(row.station_id, null);
  assert.equal(row.station, null);
  // ตั๋วต้องยังอยู่บนกระดาน ไม่ใช่หายไป
  const board = await listKitchenTickets(tenantId, null, 200, locationId);
  assert.equal(board.some((t) => t.checkId === check.id), true);
  await upsertProductStockPolicy(tenantId, { productSku: FOOD, kitchenStationId: hotStationId }, actorId);
});

test("readiness เตือนเรื่องสถานี แต่ไม่บล็อกการขาย", async () => {
  await upsertProductStockPolicy(tenantId, { productSku: FOOD, kitchenStationId: branchStationId }, actorId);
  const scoped = await getProductReadiness(tenantId, FOOD);
  assert.equal(scoped.warnings.some((w: any) => w.code === "KITCHEN_STATION_BRANCH_SCOPED"), true);
  assert.equal(scoped.blockers.some((b: any) => String(b.code).startsWith("KITCHEN_STATION")), false);

  await upsertProductStockPolicy(tenantId, { productSku: FOOD, kitchenStationId: null }, actorId);
  const missing = await getProductReadiness(tenantId, FOOD);
  assert.equal(missing.warnings.some((w: any) => w.code === "KITCHEN_STATION_MISSING"), true);
  await upsertProductStockPolicy(tenantId, { productSku: FOOD, kitchenStationId: hotStationId }, actorId);
});

test("ปิดสถานีที่ยังมีเมนูเปิดขายผูกอยู่ต้องยืนยันก่อน แล้วตั๋วยังออกได้", async () => {
  await assert.rejects(
    () => archiveKitchenStation(tenantId, hotStationId, actorId),
    /ย้ายไปสถานีอื่นก่อน/
  );
  const archived = await archiveKitchenStation(tenantId, hotStationId, actorId, { force: true });
  assert.equal(archived.active, false);
  // แถวยังอยู่ ไม่ถูกลบ — ตั๋วเก่าและ readiness อ้างถึงมันอยู่
  assert.notEqual(await getKitchenStation(tenantId, hotStationId), null);
  const inactiveWarning = await getProductReadiness(tenantId, FOOD);
  assert.equal(inactiveWarning.warnings.some((w: any) => w.code === "KITCHEN_STATION_INACTIVE"), true);

  // **สถานีที่ปิดแล้วยังรับตั๋วได้โดยตั้งใจ** — ทำให้อาหารหายจากกระดานเพราะการตั้งค่า
  // แย่กว่าการมีตั๋วบนสถานีที่กำลังจะเลิกใช้
  const check = await openRestaurantCheck({
    tenantId, locationId, tableId: tables[2].id, deviceId, shiftId, actorUserId: actorId, guestCount: 1,
  });
  await addRestaurantCheckItem({
    tenantId, locationId, checkId: check.id, sku: FOOD, size: SIZE, packQty: 1, actorUserId: actorId,
  });
  await sendRestaurantKitchenRound({
    tenantId, locationId, checkId: check.id, deviceId, shiftId, actorUserId: actorId,
  });
  const row = (await query<{ station_id: string | null }>(
    `SELECT station_id FROM bms_restaurant_kitchen_tickets WHERE tenant_id = $1 AND check_id = $2`,
    [tenantId, check.id]
  )).rows[0];
  assert.equal(row.station_id, hotStationId);
  await updateKitchenStation(tenantId, hotStationId, { active: true }, actorId);
});

test("ensureKitchenStationByNameInTx รันซ้ำได้และไม่สร้างแถวซ้ำ", async () => {
  const first = await ensureKitchenStationByNameInTx({ query }, tenantId, "ครัวย่าง");
  const second = await ensureKitchenStationByNameInTx({ query }, tenantId, "  ครัวย่าง  ");
  assert.equal(first?.id, second?.id, "ชื่อที่ต่างกันแค่ช่องว่างหัวท้ายคือสถานีเดียวกัน");
  assert.equal(await ensureKitchenStationByNameInTx({ query }, tenantId, "   "), null);
  // ชื่อคนละชื่อที่ derive ได้รหัสเดียวกันต้องได้คนละแถว ไม่ใช่แถวใดแถวหนึ่งหายไป
  const dashed = await ensureKitchenStationByNameInTx({ query }, tenantId, "ครัว-ย่าง");
  assert.notEqual(dashed?.id, first?.id);
});

test("RLS: อ่านสถานีข้ามร้านไม่ได้", async () => {
  const outsider = (await query<{ id: string }>(
    `SELECT id FROM bms_tenants WHERE slug LIKE $1 AND id <> $2 LIMIT 1`,
    [`fake-${TAG}-%`, tenantId]
  )).rows[0];
  assert.ok(outsider, "เทสก่อนหน้าต้องสร้างร้านที่สองไว้แล้ว");
  assert.deepEqual(await listKitchenStations(outsider.id, {}), []);
});

test("teardown: ไม่เหลือข้อมูลทดสอบในฐาน", async () => {
  const stale = await query<{ id: string }>(
    `SELECT id FROM bms_tenants WHERE slug LIKE $1`, [`fake-${TAG}-%`]
  );
  const ids = [...new Set([tenantId, ...stale.rows.map((r) => r.id)].filter(Boolean))];
  if (ids.length === 0) return;
  // bms_orders.restaurant_check_id กับ bms_restaurant_checks.current_order_id ชี้กันไปกลับ
  await query(
    `UPDATE bms_restaurant_checks SET current_order_id = NULL WHERE tenant_id = ANY($1::uuid[])`,
    [ids]
  );
  for (const table of [
    "bms_restaurant_kitchen_tickets",
    "bms_restaurant_check_items",
    "bms_kitchen_station_slas",
    "bms_kitchen_tickets",
    "bms_payments",
    "bms_order_items",
    "bms_order_discounts",
    "bms_tax_documents",
    "bms_pos_cash_movements",
    "bms_orders",
    "bms_restaurant_checks",
    "bms_restaurant_tables",
    "bms_restaurant_areas",
    // กะต้องไปหลังบิล: bms_orders.pos_shift_id เป็น FK แบบ NO ACTION
    "bms_pos_shifts",
    "bms_pos_devices",
    "bms_stock_movements",
    "bms_inventory",
    "bms_product_stock_policies",
    "bms_kitchen_stations",
    "bms_product_sales_surfaces",
    "bms_product_variants",
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
