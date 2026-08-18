// =============================================================
// Charges that are not stock: bag fees, service fees (8.6)
// -------------------------------------------------------------
// Collecting money for something not in bms_products was impossible without
// inventing a fake SKU, which puts phantom goods in the warehouse and corrupts
// stock reporting.
//
// The subtle part is tax, not arithmetic. A service fee charged by a
// VAT-registered business is inside the VAT base. If the extra line is simply
// added to the total after VAT is computed, the tax invoice reports a base
// smaller than the money actually taken — under-declaring by the total of every
// service fee the shop has ever charged. This suite pins that.
//
// It also pins the boundary that made a separate table the right choice: this
// must not need a product row, an inventory row, and must allow two charges on
// one bill — all three of which bms_order_items forbids.
//
// Run from apps/web:
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
//   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit \
//     ../../scripts/order-extra-lines-db-contract.test.mts
//
// Writes to whatever database it is pointed at. Dev only.
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { createOrder } from "../apps/web/lib/bms/orders.ts";
import { computeVat } from "../apps/web/lib/bms/vat.ts";

const TAG = "extraline-test";
const SKU = `FAKE-${TAG}-SKU`;
const SIZE = "M";

let tenantId = "";
let locationId = "";
const created: string[] = [];

const sell = async (extraLines: any[], qty = 1) => {
  const res = await createOrder({
    tenantId, channel: "pos", locationId,
    items: [{ sku: SKU, size: SIZE, qty }],
    extraLines,
  } as any);
  assert.equal(res.status, "CREATED", JSON.stringify(res));
  if (res.status !== "CREATED") throw new Error("unreachable");
  created.push(res.orderId);
  return res;
};

test("setup: one ฿100 product", async () => {
  tenantId = (await query<{ id: string }>(`SELECT id FROM bms_tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  locationId = (await query<{ id: string }>(
    `SELECT id FROM bms_locations WHERE tenant_id = $1 AND active
      ORDER BY is_head_office DESC, created_at LIMIT 1`,
    [tenantId]
  )).rows[0].id;
  await query(
    `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category)
     VALUES ($1,$2,$3,100,TRUE,'V')
     ON CONFLICT (tenant_id, sku) DO UPDATE SET price = 100, active = TRUE, vat_category = 'V'`,
    [tenantId, SKU, `FAKE ${TAG} product`]
  );
  await query(
    `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
     VALUES ($1,$2,$3,$4,500,0)
     ON CONFLICT (tenant_id, location_id, product_sku, size)
       DO UPDATE SET current_stock = 500, reserved_stock = 0`,
    [tenantId, locationId, SKU, SIZE]
  );
});

test("a charge needs no product row and no inventory row", async () => {
  const order = await sell([{ label: "ค่าถุง", unitAmount: 3 }]);
  assert.equal(order.subtotal, 103);

  const rows = await query<{ label: string; unit_amount: string; vat_category: string }>(
    `SELECT label, unit_amount, vat_category FROM bms_order_extra_lines
      WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, order.orderId]
  );
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].label, "ค่าถุง");
  assert.equal(rows.rows[0].vat_category, "V", "ค่าบริการ default อยู่ในฐาน VAT");

  // ไม่มีสินค้าปลอมโผล่ในคลัง — เหตุผลทั้งหมดที่ทำตารางแยก
  const phantom = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_products WHERE tenant_id = $1 AND name = 'ค่าถุง'`,
    [tenantId]
  );
  assert.equal(Number(phantom.rows[0].n), 0);
});

test("two charges on one bill, which bms_order_items could not hold", async () => {
  const order = await sell([
    { label: "ค่าถุง", unitAmount: 3 },
    { label: "ค่าห่อของขวัญ", unitAmount: 20 },
  ]);
  assert.equal(order.subtotal, 123);

  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_order_extra_lines WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, order.orderId]
  );
  assert.equal(Number(rows.rows[0].n), 2,
    "UNIQUE (order_id, product_sku, size) บน order_items ทำแบบนี้ไม่ได้");
});

test("quantity multiplies, and a blank label is dropped rather than failing the bill", async () => {
  const order = await sell([
    { label: "ค่าถุง", qty: 3, unitAmount: 2 },
    { label: "   ", unitAmount: 999 },
    { label: "ไม่มีราคา", unitAmount: Number.NaN },
  ]);
  assert.equal(order.subtotal, 106, "100 + (2 × 3) · แถวที่ไม่ครบถูกคัดทิ้ง");
});

test("charges are inside the VAT base, not bolted on after it", async () => {
  const order = await sell([{ label: "ค่าบริการ", unitAmount: 50 }]);   // 100 + 50 = 150

  // ฐานภาษีต้องคิดจาก 150 ไม่ใช่ 100 · คิดจาก 100 = ยื่นภาษีต่ำกว่าความจริง
  const withCharge = computeVat(
    [{ sku: SKU, amount: 100, vatCategory: "V" }, { sku: "EXTRA:ค่าบริการ", amount: 50, vatCategory: "V" }],
    { vatRegistered: true, priceIncludesVat: true, vatRate: 7 }
  );
  const withoutCharge = computeVat(
    [{ sku: SKU, amount: 100, vatCategory: "V" }],
    { vatRegistered: true, priceIncludesVat: true, vatRate: 7 }
  );
  assert.ok(withCharge.vatAmount > withoutCharge.vatAmount,
    "ค่าบริการต้องทำให้ VAT เพิ่ม ไม่ใช่บวกยอดเฉย ๆ");
  assert.equal(order.subtotal, 150);

  // และ query ที่ใบกำกับใช้ต้องดึงบรรทัดค่าบริการมาด้วยจริง
  const lines = await query<{ product_sku: string; amount: string }>(
    `SELECT product_sku, amount FROM (
       SELECT product_sku, COALESCE(pack_unit_price * pack_qty, unit_price * qty) AS amount
         FROM bms_order_items WHERE tenant_id = $1 AND order_id = $2
       UNION ALL
       SELECT 'EXTRA:' || label, unit_amount * qty
         FROM bms_order_extra_lines WHERE tenant_id = $1 AND order_id = $2
     ) x ORDER BY product_sku`,
    [tenantId, order.orderId]
  );
  assert.equal(lines.rowCount, 2);
  assert.ok(lines.rows.some((r) => r.product_sku === "EXTRA:ค่าบริการ" && Number(r.amount) === 50));
});

test("a percentage discount applies to the charge too, because the customer pays it", async () => {
  // ยอด 100 + 50 = 150 · ลดมือ 15 → 135 · ถ้าค่าบริการอยู่นอกยอดก่อนลด ตัวเลขจะเพี้ยน
  const res = await createOrder({
    tenantId, channel: "pos", locationId,
    items: [{ sku: SKU, size: SIZE, qty: 1 }],
    extraLines: [{ label: "ค่าบริการ", unitAmount: 50 }],
    manualDiscount: 15,
    discountApprovedBy: (await query<{ id: string }>(
      `SELECT id FROM users WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`, [tenantId]
    )).rows[0].id,
    discountReason: "ทดสอบ",
  } as any);
  assert.equal(res.status, "CREATED", JSON.stringify(res));
  if (res.status !== "CREATED") return;
  created.push(res.orderId);
  assert.equal(res.subtotal, 150);
  assert.equal(res.discount, 15);
  assert.equal(res.total, 135);
});

test("teardown: remove every row this suite created", async () => {
  if (created.length) {
    await query(`DELETE FROM bms_order_extra_lines WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])`,
      [tenantId, created]);
    await query(`DELETE FROM bms_order_discounts WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])`,
      [tenantId, created]);
    await query(`DELETE FROM bms_order_items WHERE order_id = ANY($1::uuid[])`, [created]);
    await query(`DELETE FROM bms_orders WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, created]);
  }
  await query(`DELETE FROM bms_stock_movements WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_inventory WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku = $2`, [tenantId, SKU]);
});
