// =============================================================
// "Who reserved this?" — explaining bms_inventory.reserved_stock
// -------------------------------------------------------------
// reserved_stock is a running total. Nothing records which bill owns which
// reserved unit, so the number on the products page cannot answer the one
// question staff actually ask: a customer wants the last piece on the shelf —
// who is holding it, and can we sell it?
//
// listVariantReservations() rebuilds that answer from the bills that still hold
// stock. Three things can make the rebuilt answer wrong in ways nobody would
// notice on screen:
//
//   1. Reading bms_order_items instead of the bms_order_stock_lines view (8.8):
//      a set reserves its COMPONENTS, so a bill that bought a gift set would be
//      missing from the component's list while still holding its stock.
//   2. Including bills that already released their stock (SHIPPED/CANCELLED),
//      which invents holders for units that are free to sell.
//   3. Hiding the difference between the table total and what the bills explain.
//      A hold taken through /api/bms/reserve, a bill that failed midway, or a
//      hand-edit can lock stock with no order behind it — reporting only the
//      explainable part tells the reader the list is complete when it is not.
//
// Run from apps/web:
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
//   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit \
//     ../../scripts/variant-reservations-db-contract.test.mts
//
// Writes to whatever database it is pointed at. Dev only.
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { cancelOrder, createOrder, payOrder, packOrder, shipOrder } from "../apps/web/lib/bms/orders.ts";
import { listVariantReservations } from "../apps/web/lib/bms/stock.ts";

const TAG = "resv-test";
const PLAIN = `FAKE-${TAG}-CREAM`;
const SET = `FAKE-${TAG}-SET`;
const SET2 = `FAKE-${TAG}-SET2`;
const PART = `FAKE-${TAG}-PART`;
const SIZE = "M";
const SKUS = [PLAIN, SET, SET2, PART];

let tenantId = "";
let locationId = "";
const created: string[] = [];

const reservedOf = async (sku: string) => {
  const res = await query<{ r: number }>(
    `SELECT reserved_stock AS r FROM bms_inventory
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, sku, SIZE]
  );
  return res.rowCount ? Number(res.rows[0].r) : null;
};

/** ลบเศษของรอบก่อน — FK bms_order_items → bms_inventory บล็อกการลบ inventory */
const dropOrdersTouching = async (skus: string[]) => {
  const stale = await query<{ order_id: string }>(
    `SELECT DISTINCT order_id FROM bms_order_items
      WHERE tenant_id = $1 AND product_sku = ANY($2::text[])`,
    [tenantId, skus]
  );
  if (!stale.rowCount) return;
  const ids = stale.rows.map((r) => r.order_id);
  await query(`DELETE FROM bms_order_item_lots WHERE order_item_id IN (
                 SELECT id FROM bms_order_items WHERE order_id = ANY($1::uuid[]))`, [ids]);
  await query(`DELETE FROM bms_order_items WHERE order_id = ANY($1::uuid[])`, [ids]);
  await query(`DELETE FROM bms_orders WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, ids]);
};

test("setup: one ordinary product and one set built from a component", async () => {
  tenantId = (await query<{ id: string }>(`SELECT id FROM bms_tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  locationId = (await query<{ id: string }>(
    `SELECT id FROM bms_locations WHERE tenant_id = $1 AND active
      ORDER BY is_head_office DESC, created_at LIMIT 1`,
    [tenantId]
  )).rows[0].id;

  for (const [sku, price, isBundle] of [
    [PLAIN, 100, false], [PART, 60, false], [SET, 150, true], [SET2, 90, true],
  ] as Array<[string, number, boolean]>) {
    await query(
      `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category, is_bundle)
       VALUES ($1,$2,$3,$4,TRUE,'V',$5)
       ON CONFLICT (tenant_id, sku) DO UPDATE
         SET price = EXCLUDED.price, active = TRUE, is_bundle = EXCLUDED.is_bundle`,
      [tenantId, sku, `FAKE ${TAG} ${sku}`, price, isBundle]
    );
  }
  await dropOrdersTouching(SKUS);
  for (const sku of [PLAIN, PART]) {
    await query(
      `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
       VALUES ($1,$2,$3,$4,20,0)
       ON CONFLICT (tenant_id, location_id, product_sku, size)
         DO UPDATE SET current_stock = 20, reserved_stock = 0`,
      [tenantId, locationId, sku, SIZE]
    );
  }
  await query(
    `DELETE FROM bms_inventory WHERE tenant_id = $1 AND product_sku = ANY($2::text[])`,
    [tenantId, [SET, SET2]]
  );
  await query(
    `DELETE FROM bms_product_bundle_items WHERE tenant_id = $1 AND bundle_sku = ANY($2::text[])`,
    [tenantId, [SET, SET2]]
  );
  // สองเซ็ตที่ใช้ส่วนประกอบตัวเดียวกัน — เกิดจริงเวลาร้านจัดกระเช้าหลายแบบจากของชิ้นเดิม
  for (const [bundle, qty] of [[SET, 2], [SET2, 1]] as Array<[string, number]>) {
    await query(
      `INSERT INTO bms_product_bundle_items (tenant_id, bundle_sku, component_sku, component_size, qty)
       VALUES ($1,$2,$3,$4,$5)`,
      [tenantId, bundle, PART, SIZE, qty]
    );
  }
});

test("nothing reserved reads as nothing reserved, not as an unexplained hold", async () => {
  const res = await listVariantReservations(tenantId, PLAIN, SIZE);
  assert.equal(res.reservedTotal, 0);
  assert.equal(res.attributedTotal, 0);
  assert.equal(res.unattributed, 0);
  assert.equal(res.orderCount, 0);
  assert.deepEqual(res.orders, []);
});

test("a pending bill is named, with its quantity and channel", async () => {
  const res = await createOrder({
    tenantId, channel: "line", customerRef: `${TAG}-buyer`, locationId,
    items: [{ sku: PLAIN, size: SIZE, qty: 3 }],
  } as any);
  assert.equal(res.status, "CREATED", JSON.stringify(res));
  if (res.status !== "CREATED") return;
  created.push(res.orderId);

  const view = await listVariantReservations(tenantId, PLAIN, SIZE);
  assert.equal(view.reservedTotal, 3);
  assert.equal(view.attributedTotal, 3);
  assert.equal(view.unattributed, 0, "ยอดจองที่อธิบายไม่ได้ต้องเป็น 0 เมื่อมีบิลรับผิดชอบครบ");
  assert.equal(view.orderCount, 1);
  assert.equal(view.orders.length, 1);

  const row = view.orders[0];
  assert.equal(row.orderId, res.orderId);
  assert.equal(row.qty, 3);
  assert.equal(row.status, "PENDING");
  assert.equal(row.channel, "line");
  assert.deepEqual(row.viaBundleSkus, [], "บิลนี้ซื้อสินค้าตัวนี้ตรง ๆ ไม่ได้ผ่านเซ็ต");
  assert.ok(row.locationName || row.branchCode, "ต้องบอกสาขาได้ — การจองเป็นของสาขา ไม่ใช่ของร้านทั้งร้าน");
  assert.ok(
    !Number.isNaN(Date.parse(row.createdAt)),
    "createdAt ต้องเป็น ISO string — pg คืน Date แล้ว GraphQL String! จะ serialize เป็น epoch"
  );
});

test("the amount a bill holds follows the bill, not the size's whole reservation", async () => {
  const second = await createOrder({
    tenantId, channel: "web", customerRef: `${TAG}-buyer-2`, locationId,
    items: [{ sku: PLAIN, size: SIZE, qty: 2 }],
  } as any);
  assert.equal(second.status, "CREATED", JSON.stringify(second));
  if (second.status !== "CREATED") return;
  created.push(second.orderId);

  const view = await listVariantReservations(tenantId, PLAIN, SIZE);
  assert.equal(view.reservedTotal, 5);
  assert.equal(view.attributedTotal, 5);
  assert.equal(view.orderCount, 2);
  const qtyById = new Map(view.orders.map((o) => [o.orderId, o.qty]));
  assert.equal(qtyById.get(created[0]), 3);
  assert.equal(qtyById.get(second.orderId), 2,
    "แต่ละบิลต้องแสดงจำนวนของตัวเอง ไม่ใช่ยอดจองรวมของไซซ์"
  );
});

test("a cancelled bill disappears instead of lingering as a fake holder", async () => {
  const doomed = created.pop()!;
  await cancelOrder(tenantId, doomed);

  const view = await listVariantReservations(tenantId, PLAIN, SIZE);
  assert.equal(view.reservedTotal, 3, "ยกเลิกแล้วของต้องถูกปล่อยจริงในตาราง");
  assert.equal(view.orderCount, 1);
  assert.equal(view.orders.some((o) => o.orderId === doomed), false,
    "บิลที่ยกเลิกยังโผล่อยู่ = พนักงานปฏิเสธการขายของที่ว่างอยู่"
  );
});

test("a shipped bill stops holding stock and stops being listed", async () => {
  const orderId = created[0];
  // shipOrder ปฏิเสธช่องทางที่ร้านต้องเก็บที่อยู่เอง ถ้าลูกค้าไม่มีที่อยู่จัดส่ง —
  // เทสต้องเดินเส้นทางปล่อยของจริง ไม่ใช่ UPDATE สถานะเอง
  await query(
    `INSERT INTO bms_customer_addresses (tenant_id, customer_id, label, address, address_type)
     SELECT o.tenant_id, o.customer_id, $3, $4, 'shipping'
       FROM bms_orders o
      WHERE o.tenant_id = $1 AND o.id = $2 AND o.customer_id IS NOT NULL`,
    [tenantId, orderId, `FAKE ${TAG}`, `FAKE ${TAG} address`]
  );
  assert.equal(await payOrder(tenantId, orderId), true);
  assert.equal(await packOrder(tenantId, orderId), true);

  const whilePacking = await listVariantReservations(tenantId, PLAIN, SIZE);
  assert.equal(whilePacking.orders.some((o) => o.orderId === orderId), true,
    "PACKING ยังถือของอยู่ (ปล่อยตอน SHIPPED) จึงต้องยังอยู่ในรายการ"
  );
  assert.equal(whilePacking.orders.find((o) => o.orderId === orderId)?.status, "PACKING");

  assert.equal(await shipOrder(tenantId, orderId), true);
  const afterShip = await listVariantReservations(tenantId, PLAIN, SIZE);
  assert.equal(afterShip.reservedTotal, 0, "ส่งของแล้วตัดทั้ง current และ reserved");
  assert.equal(afterShip.orderCount, 0);
  assert.equal(afterShip.unattributed, 0);
  created.length = 0;
});

test("a bill that bought a set shows up under the component it actually holds", async () => {
  const res = await createOrder({
    tenantId, channel: "pos", customerRef: `${TAG}-set-buyer`, locationId,
    items: [{ sku: SET, size: SIZE, qty: 2 }],
  } as any);
  assert.equal(res.status, "CREATED", JSON.stringify(res));
  if (res.status !== "CREATED") return;
  created.push(res.orderId);

  assert.equal(await reservedOf(PART), 4, "2 เซ็ต × ส่วนประกอบ 2");

  const part = await listVariantReservations(tenantId, PART, SIZE);
  assert.equal(part.reservedTotal, 4);
  assert.equal(part.attributedTotal, 4);
  assert.equal(part.unattributed, 0,
    "อ่านจาก bms_order_items จะได้ 0 ที่นี่ แล้วของ 4 ชิ้นจะดูเหมือนถูกจองโดยไม่มีใครรับผิดชอบ"
  );
  assert.equal(part.orders.length, 1);
  assert.equal(part.orders[0].orderId, res.orderId);
  assert.equal(part.orders[0].qty, 4, "จำนวนที่บิลถือคือจำนวนส่วนประกอบ ไม่ใช่จำนวนเซ็ต");
  assert.deepEqual(part.orders[0].viaBundleSkus, [SET],
    "ต้องบอกว่ามาจากเซ็ตไหน ไม่งั้นพนักงานเปิดบิลแล้วไม่เห็นสินค้าตัวนี้ในบิลเลย"
  );

  // และตัวเซ็ตเองไม่ถือของ — แถวสต็อกของเซ็ตค้างที่ 0 ตามการออกแบบของ 8.8
  const set = await listVariantReservations(tenantId, SET, SIZE);
  assert.equal(set.reservedTotal, 0);
  assert.equal(set.orderCount, 0);
});

test("one bill holding a component through two sets names both", async () => {
  const res = await createOrder({
    tenantId, channel: "pos", customerRef: `${TAG}-two-sets`, locationId,
    items: [{ sku: SET, size: SIZE, qty: 1 }, { sku: SET2, size: SIZE, qty: 1 }],
  } as any);
  assert.equal(res.status, "CREATED", JSON.stringify(res));
  if (res.status !== "CREATED") return;
  created.push(res.orderId);

  const part = await listVariantReservations(tenantId, PART, SIZE);
  const row = part.orders.find((o) => o.orderId === res.orderId);
  assert.ok(row, "บิลที่ซื้อสองเซ็ตต้องอยู่ในรายการของส่วนประกอบ");
  assert.equal(row!.qty, 3, "เซ็ตแรกใช้ 2 + เซ็ตที่สองใช้ 1");
  assert.deepEqual([...row!.viaBundleSkus].sort(), [SET, SET2].sort(),
    "บอกเซ็ตเดียวคือบอกเหตุผลไม่ครบ พนักงานจะหาสินค้าตัวนี้ในบิลไม่เจออีกครึ่ง"
  );

  await cancelOrder(tenantId, created.pop()!);
});

test("stock reserved with no bill behind it is reported, not silently dropped", async () => {
  // การจองที่ไม่มีบิลผูกอยู่ (hold ผ่าน /api/bms/reserve, บิลที่ล้มกลางทาง, แก้ฐานด้วยมือ)
  await query(
    `UPDATE bms_inventory SET reserved_stock = reserved_stock + 2
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, PART, SIZE]
  );

  const view = await listVariantReservations(tenantId, PART, SIZE);
  assert.equal(view.reservedTotal, 6);
  assert.equal(view.attributedTotal, 4, "บิลที่มีอยู่ยังอธิบายได้แค่ 4");
  assert.equal(view.unattributed, 2,
    "ส่วนที่อธิบายไม่ได้ต้องโชว์ — ของ 2 ชิ้นนี้ขายไม่ได้และไม่มีบิลให้ตามแก้"
  );

  await query(
    `UPDATE bms_inventory SET reserved_stock = reserved_stock - 2
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, PART, SIZE]
  );
});

test("unattributed never goes negative when the table lags behind the bills", async () => {
  // ตารางถูกแก้ให้ต่ำกว่าที่บิลถืออยู่ (เคสซ่อมมือผิด/บั๊กปล่อยซ้ำ) — ตัวเลขติดลบ
  // จะอ่านเหมือน "มีของเกินให้ขาย" ซึ่งอันตรายกว่าการรายงาน 0
  await query(
    `UPDATE bms_inventory SET reserved_stock = 1
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, PART, SIZE]
  );
  const view = await listVariantReservations(tenantId, PART, SIZE);
  assert.equal(view.reservedTotal, 1);
  assert.equal(view.attributedTotal, 4);
  assert.equal(view.unattributed, 0);

  await query(
    `UPDATE bms_inventory SET reserved_stock = 4
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, PART, SIZE]
  );
});

test("another shop's id sees nothing of this shop's reservations", async () => {
  const other = await query<{ id: string }>(
    `SELECT id FROM bms_tenants WHERE id <> $1 ORDER BY created_at LIMIT 1`,
    [tenantId]
  );
  if (!other.rowCount) {
    // ฐานที่มีร้านเดียว — ข้ามได้ แต่ต้องบอกว่าข้าม ไม่ใช่ปล่อยให้ดูเหมือนผ่าน
    console.log("  (skipped: this database has only one tenant)");
    return;
  }
  const view = await listVariantReservations(other.rows[0].id, PART, SIZE);
  assert.equal(view.reservedTotal, 0);
  assert.equal(view.attributedTotal, 0);
  assert.equal(view.orderCount, 0);
});

test("teardown: remove every row this suite created", async () => {
  for (const id of created) await cancelOrder(tenantId, id).catch(() => {});
  await query(`DELETE FROM bms_customer_addresses WHERE tenant_id = $1 AND label = $2`, [tenantId, `FAKE ${TAG}`]);
  await dropOrdersTouching(SKUS);
  await query(
    `DELETE FROM bms_product_bundle_items WHERE tenant_id = $1 AND bundle_sku = ANY($2::text[])`,
    [tenantId, [SET, SET2]]
  );
  await query(`DELETE FROM bms_stock_movements WHERE tenant_id = $1 AND product_sku = ANY($2::text[])`, [tenantId, SKUS]);
  await query(`DELETE FROM bms_inventory WHERE tenant_id = $1 AND product_sku = ANY($2::text[])`, [tenantId, SKUS]);
  await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku = ANY($2::text[])`, [tenantId, SKUS]);
});
