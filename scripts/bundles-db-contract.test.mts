// =============================================================
// Bundles / kits: sell one, deduct several (8.8)
// -------------------------------------------------------------
// A gift set is one thing the customer buys and three things that leave the
// warehouse. The structural problem is that bms_order_items has an FK to
// bms_inventory, so every line needs a stock row — but a set is not stocked.
//
// The chosen answer: the set gets an inventory row that stays at 0, reservation
// skips it and goes to the components, and a database view (bms_order_stock_lines)
// expands set lines into components so every place that moves stock sees the
// components. There were FOUR such places — deduct at sale, restore on return,
// release reservations, and FEFO lot consumption. Each one reading the raw table
// would be a separate way for stock to drift.
//
// This suite exists because "sold a set and the components did not move" is
// invisible until someone counts the shelf.
//
// Run from apps/web:
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
//   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit \
//     ../../scripts/bundles-db-contract.test.mts
//
// Writes to whatever database it is pointed at. Dev only.
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { cancelOrder, createOrder } from "../apps/web/lib/bms/orders.ts";

const TAG = "bundle-test";
const SET = `FAKE-${TAG}-SET`;
const SOAP = `FAKE-${TAG}-SOAP`;
const LOTION = `FAKE-${TAG}-LOTION`;
const SIZE = "M";

let tenantId = "";
let locationId = "";
const created: string[] = [];

const stock = async (sku: string) => {
  const res = await query<{ c: number; r: number }>(
    `SELECT current_stock AS c, reserved_stock AS r FROM bms_inventory
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, sku, SIZE]
  );
  return res.rowCount ? { current: Number(res.rows[0].c), reserved: Number(res.rows[0].r) } : null;
};

test("setup: a set of 1 soap + 2 lotions, priced below buying loose", async () => {
  tenantId = (await query<{ id: string }>(`SELECT id FROM bms_tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  locationId = (await query<{ id: string }>(
    `SELECT id FROM bms_locations WHERE tenant_id = $1 AND active
      ORDER BY is_head_office DESC, created_at LIMIT 1`,
    [tenantId]
  )).rows[0].id;

  // ส่วนประกอบ 100 + (2 × 80) = 260 · ตั้งราคาเซ็ต 220 ซึ่งเป็นเหตุผลที่ร้านทำเซ็ต
  for (const [sku, price, isBundle] of [
    [SOAP, 100, false], [LOTION, 80, false], [SET, 220, true],
  ] as Array<[string, number, boolean]>) {
    await query(
      `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category, is_bundle)
       VALUES ($1,$2,$3,$4,TRUE,'V',$5)
       ON CONFLICT (tenant_id, sku) DO UPDATE
         SET price = EXCLUDED.price, active = TRUE, is_bundle = EXCLUDED.is_bundle`,
      [tenantId, sku, `FAKE ${TAG} ${sku}`, price, isBundle]
    );
  }
  for (const sku of [SOAP, LOTION]) {
    await query(
      `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
       VALUES ($1,$2,$3,$4,20,0)
       ON CONFLICT (tenant_id, location_id, product_sku, size)
         DO UPDATE SET current_stock = 20, reserved_stock = 0`,
      [tenantId, locationId, sku, SIZE]
    );
  }
  // เก็บเศษของรอบก่อนก่อน — FK bms_order_items → bms_inventory บล็อกการลบ inventory
  // ถ้ายังมีบิลค้างอ้างอยู่ · ชุดนี้ต้องรันซ้ำได้แม้รอบก่อนล้มกลางทาง
  const stale = await query<{ order_id: string }>(
    `SELECT DISTINCT order_id FROM bms_order_items
      WHERE tenant_id = $1 AND product_sku = ANY($2::text[])`,
    [tenantId, [SET, SOAP, LOTION]]
  );
  if (stale.rowCount) {
    const ids = stale.rows.map((r) => r.order_id);
    await query(`DELETE FROM bms_order_items WHERE order_id = ANY($1::uuid[])`, [ids]);
    await query(`DELETE FROM bms_orders WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, ids]);
  }

  // เซ็ตยังไม่มีแถวสต็อก — createOrder ต้องสร้างให้เองตอนขายครั้งแรก
  await query(`DELETE FROM bms_inventory WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SET]);
  await query(`DELETE FROM bms_product_bundle_items WHERE tenant_id = $1 AND bundle_sku = $2`, [tenantId, SET]);
  for (const [sku, qty] of [[SOAP, 1], [LOTION, 2]] as Array<[string, number]>) {
    await query(
      `INSERT INTO bms_product_bundle_items (tenant_id, bundle_sku, component_sku, component_size, qty)
       VALUES ($1,$2,$3,$4,$5)`,
      [tenantId, SET, sku, SIZE, qty]
    );
  }
});

test("a set with no components cannot be sold at all", async () => {
  await query(`DELETE FROM bms_product_bundle_items WHERE tenant_id = $1 AND bundle_sku = $2`, [tenantId, SET]);
  const res = await createOrder({
    tenantId, channel: "pos", locationId, items: [{ sku: SET, size: SIZE, qty: 1 }],
  } as any);
  assert.equal(res.status, "BUNDLE_INCOMPLETE",
    "ปล่อยผ่านคือขายของที่ไม่มีอะไรออกจากคลังเลย");

  for (const [sku, qty] of [[SOAP, 1], [LOTION, 2]] as Array<[string, number]>) {
    await query(
      `INSERT INTO bms_product_bundle_items (tenant_id, bundle_sku, component_sku, component_size, qty)
       VALUES ($1,$2,$3,$4,$5)`,
      [tenantId, SET, sku, SIZE, qty]
    );
  }
});

test("selling one set reserves its components, not itself, and charges the set price", async () => {
  const res = await createOrder({
    tenantId, channel: "pos", locationId, items: [{ sku: SET, size: SIZE, qty: 2 }],
  } as any);
  assert.equal(res.status, "CREATED", JSON.stringify(res));
  if (res.status !== "CREATED") return;
  created.push(res.orderId);

  assert.equal(res.subtotal, 440, "ราคาของเซ็ต × 2 ไม่ใช่ราคาส่วนประกอบรวม");

  const soap = await stock(SOAP);
  const lotion = await stock(LOTION);
  const set = await stock(SET);
  assert.equal(soap!.reserved, 2, "2 เซ็ต × สบู่ 1");
  assert.equal(lotion!.reserved, 4, "2 เซ็ต × โลชั่น 2");
  assert.ok(set, "เซ็ตต้องได้แถวสต็อกของตัวเอง (FK ของ order_items บังคับ)");
  assert.equal(set!.current, 0, "และค้างอยู่ที่ 0 — เซ็ตไม่ถูกนับเป็นสต็อก");
  assert.equal(set!.reserved, 0);
});

test("cancelling releases the components, and the set never goes negative", async () => {
  const orderId = created.pop()!;
  await cancelOrder(tenantId, orderId);
  assert.equal((await stock(SOAP))!.reserved, 0);
  assert.equal((await stock(LOTION))!.reserved, 0);
  const set = await stock(SET);
  assert.equal(set!.current, 0);
  assert.equal(set!.reserved, 0,
    "ถ้าปล่อย reserved อ่านจากตารางตรง ๆ แถวเซ็ตจะติดลบแล้วชน CHECK");
});

test("a component running short blocks the set and names the component", async () => {
  await query(
    `UPDATE bms_inventory SET current_stock = 1, reserved_stock = 0
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, LOTION, SIZE]
  );
  const res = await createOrder({
    tenantId, channel: "pos", locationId, items: [{ sku: SET, size: SIZE, qty: 1 }],
  } as any);
  assert.equal(res.status, "INSUFFICIENT");
  if (res.status === "INSUFFICIENT") {
    assert.equal(res.sku, LOTION, "ต้องบอกว่าส่วนประกอบตัวไหนขาด ไม่ใช่บอกว่า 'เซ็ตหมด'");
    assert.equal(res.requested, 2);
  }

  // และรายการที่ล้มต้องไม่ทิ้งการจองค้างที่ส่วนประกอบตัวแรก
  assert.equal((await stock(SOAP))!.reserved, 0, "สบู่ต้องไม่ถูกจองค้างจากบิลที่ล้ม");

  await query(
    `UPDATE bms_inventory SET current_stock = 20, reserved_stock = 0
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, LOTION, SIZE]
  );
});

test("the stock-lines view expands the set for everything that moves stock", async () => {
  const res = await createOrder({
    tenantId, channel: "pos", locationId,
    items: [{ sku: SET, size: SIZE, qty: 1 }, { sku: SOAP, size: SIZE, qty: 3 }],
  } as any);
  assert.equal(res.status, "CREATED", JSON.stringify(res));
  if (res.status !== "CREATED") return;
  created.push(res.orderId);

  const view = await query<{ product_sku: string; qty: number }>(
    `SELECT product_sku, SUM(qty)::int AS qty FROM bms_order_stock_lines
      WHERE tenant_id = $1 AND order_id = $2 GROUP BY product_sku ORDER BY product_sku`,
    [tenantId, res.orderId]
  );
  const bySku = new Map(view.rows.map((r) => [r.product_sku, Number(r.qty)]));
  assert.equal(bySku.get(SOAP), 4, "สบู่ 3 ที่ซื้อแยก + 1 จากเซ็ต");
  assert.equal(bySku.get(LOTION), 2);
  assert.equal(bySku.has(SET), false, "ตัวเซ็ตต้องไม่โผล่ในบรรทัดที่กระทบสต็อก");

  // ใบเสร็จยังต้องเห็นชื่อเซ็ต ซึ่งคือสิ่งที่ลูกค้าซื้อ
  const items = await query<{ product_sku: string }>(
    `SELECT product_sku FROM bms_order_items WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, res.orderId]
  );
  assert.ok(items.rows.some((r) => r.product_sku === SET),
    "bms_order_items ต้องยังมีบรรทัดเซ็ต — ใบเสร็จแสดงสิ่งที่ลูกค้าซื้อ ไม่ใช่ส่วนประกอบ");
});

test("teardown: remove every row this suite created", async () => {
  for (const id of created) await cancelOrder(tenantId, id).catch(() => {});

  // ลบตาม SKU ไม่ใช่ตามลิสต์ของรอบนี้ — รอบที่ teardown ล้มกลางทางจะทิ้งบิลค้างไว้
  // แล้ว FK bms_order_items → bms_inventory จะบล็อกการลบ inventory ของรอบถัดไป
  // (เจอมาแล้ว: รอบสองล้มเพราะเศษของรอบแรก)
  const skusForCleanup = [SET, SOAP, LOTION];
  const orphan = await query<{ order_id: string }>(
    `SELECT DISTINCT order_id FROM bms_order_items
      WHERE tenant_id = $1 AND product_sku = ANY($2::text[])`,
    [tenantId, skusForCleanup]
  );
  const allOrders = Array.from(new Set([...created, ...orphan.rows.map((r) => r.order_id)]));
  if (allOrders.length) {
    await query(`DELETE FROM bms_order_items WHERE order_id = ANY($1::uuid[])`, [allOrders]);
    await query(`DELETE FROM bms_orders WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, allOrders]);
  }
  await query(`DELETE FROM bms_product_bundle_items WHERE tenant_id = $1 AND bundle_sku = $2`, [tenantId, SET]);
  const skus = [SET, SOAP, LOTION];
  await query(`DELETE FROM bms_stock_movements WHERE tenant_id = $1 AND product_sku = ANY($2::text[])`, [tenantId, skus]);
  await query(`DELETE FROM bms_inventory WHERE tenant_id = $1 AND product_sku = ANY($2::text[])`, [tenantId, skus]);
  await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku = ANY($2::text[])`, [tenantId, skus]);
});
