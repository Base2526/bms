// =============================================================
// Buy-X-get-Y and N-for-a-price, end to end (8.7)
// -------------------------------------------------------------
// pricing-contract.test.mts proves the arithmetic without a database. This proves
// what only a real order can:
//
//   - createOrder charges the promotion price
//   - the promotion is counted ONCE per SKU per bill, not once per line — the
//     quantity spans sizes, so charging per line would bill the offer twice
//   - the counter's preview and the committed total agree, or the register's
//     payment rows miss the server total and the bill dies as PAYMENT_MISMATCH
//   - an expired promotion stops applying without anyone editing the product
//
// Run from apps/web:
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
//   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit \
//     ../../scripts/promotions-db-contract.test.mts
//
// Writes to whatever database it is pointed at. Dev only.
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { createOrder } from "../apps/web/lib/bms/orders.ts";
import { resolvePosScan } from "../apps/web/lib/bms/pos.ts";
import { applyPromotion } from "../apps/web/lib/bms/pricing.ts";

const TAG = "promo-test";
const SKU = `FAKE-${TAG}-SKU`;
const SIZE_S = "60ML";
const SIZE_L = "150ML";

let tenantId = "";
let locationId = "";
const created: string[] = [];

const sell = async (lines: Array<{ size: string; qty: number }>) => {
  const res = await createOrder({
    tenantId, channel: "pos", locationId,
    items: lines.map((l) => ({ sku: SKU, size: l.size, qty: l.qty })),
  } as any);
  assert.equal(res.status, "CREATED", JSON.stringify(res));
  if (res.status !== "CREATED") throw new Error("unreachable");
  created.push(res.orderId);
  return res;
};

const setPromo = async (sql: string, params: any[]) => {
  await query(`DELETE FROM bms_product_promotions WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  if (sql) await query(sql, params);
};

test("setup: one ฿40 product in two sizes", async () => {
  tenantId = (await query<{ id: string }>(`SELECT id FROM bms_tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  locationId = (await query<{ id: string }>(
    `SELECT id FROM bms_locations WHERE tenant_id = $1 AND active
      ORDER BY is_head_office DESC, created_at LIMIT 1`,
    [tenantId]
  )).rows[0].id;
  await query(
    `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category)
     VALUES ($1,$2,$3,40,TRUE,'V')
     ON CONFLICT (tenant_id, sku) DO UPDATE SET price = 40, active = TRUE`,
    [tenantId, SKU, `FAKE ${TAG} product`]
  );
  for (const size of [SIZE_S, SIZE_L]) {
    await query(
      `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
       VALUES ($1,$2,$3,$4,500,0)
       ON CONFLICT (tenant_id, location_id, product_sku, size)
         DO UPDATE SET current_stock = 500, reserved_stock = 0`,
      [tenantId, locationId, SKU, size]
    );
  }
  await query(`DELETE FROM bms_product_price_tiers WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
});

test("buy 3 get 1: four units cost three", async () => {
  await setPromo(
    `INSERT INTO bms_product_promotions (tenant_id, product_sku, kind, buy_qty, get_qty)
     VALUES ($1,$2,'BUY_X_GET_Y',3,1)`,
    [tenantId, SKU]
  );
  const order = await sell([{ size: SIZE_S, qty: 4 }]);
  assert.equal(order.subtotal, 120, "จ่าย 3 ชิ้น ได้ 4");
});

test("the promotion is charged once per SKU even when the bill has several lines", async () => {
  // 2 ขวดเล็ก + 2 ขวดใหญ่ = ซื้อสินค้านั้น 4 ชิ้น → ต้องจ่าย 3 ชิ้น = 120
  // ถ้าคิดต่อบรรทัด แต่ละบรรทัดมี 2 ชิ้น (ยังไม่ครบชุด) → จ่ายเต็ม 160
  // ถ้าคิดโปรซ้ำทุกบรรทัด → เก็บเงินเป็นสองเท่าของยอดโปร
  const order = await sell([{ size: SIZE_S, qty: 2 }, { size: SIZE_L, qty: 2 }]);
  assert.equal(order.subtotal, 120, "จำนวนรวมทั้งบิลต่อ SKU และคิดโปรครั้งเดียว");
  assert.notEqual(order.subtotal, 160);
  assert.notEqual(order.subtotal, 240);
});

test("3 for 100: the remainder pays full price", async () => {
  await setPromo(
    `INSERT INTO bms_product_promotions (tenant_id, product_sku, kind, buy_qty, bundle_price)
     VALUES ($1,$2,'N_FOR_PRICE',3,100)`,
    [tenantId, SKU]
  );
  assert.equal((await sell([{ size: SIZE_S, qty: 3 }])).subtotal, 100);
  assert.equal((await sell([{ size: SIZE_S, qty: 4 }])).subtotal, 140);
  assert.equal((await sell([{ size: SIZE_S, qty: 6 }])).subtotal, 200);
});

test("what the counter previews is what createOrder charges", async () => {
  const hit = await resolvePosScan(tenantId, SKU, { size: SIZE_S, locationId });
  assert.ok(hit?.promotion, "โปรต้องถูกส่งไปให้จอ");

  const qty = 7;
  const preview = applyPromotion(hit!.basePrice, qty, hit!.promotion!);
  const order = await sell([{ size: SIZE_S, qty }]);
  assert.equal(order.subtotal, preview.amount,
    "ต่างกันแม้บาทเดียว = บิลถูกตีตก PAYMENT_MISMATCH หน้าลูกค้า");
});

test("an expired promotion stops applying by itself", async () => {
  await setPromo(
    `INSERT INTO bms_product_promotions (tenant_id, product_sku, kind, buy_qty, get_qty, starts_at, ends_at)
     VALUES ($1,$2,'BUY_X_GET_Y',3,1, now() - interval '2 days', now() - interval '1 day')`,
    [tenantId, SKU]
  );
  assert.equal((await sell([{ size: SIZE_S, qty: 4 }])).subtotal, 160,
    "โปรหมดช่วงเวลาแล้วต้องคิดราคาเต็ม โดยไม่ต้องมีใครไปแก้สินค้า");

  // และโปรที่ยังไม่เริ่มก็ต้องยังไม่ใช้
  await setPromo(
    `INSERT INTO bms_product_promotions (tenant_id, product_sku, kind, buy_qty, get_qty, starts_at)
     VALUES ($1,$2,'BUY_X_GET_Y',3,1, now() + interval '1 day')`,
    [tenantId, SKU]
  );
  assert.equal((await sell([{ size: SIZE_S, qty: 4 }])).subtotal, 160);
});

test("a deactivated promotion does not apply, and only one can be active per product", async () => {
  await setPromo(
    `INSERT INTO bms_product_promotions (tenant_id, product_sku, kind, buy_qty, get_qty, active)
     VALUES ($1,$2,'BUY_X_GET_Y',3,1,FALSE)`,
    [tenantId, SKU]
  );
  assert.equal((await sell([{ size: SIZE_S, qty: 4 }])).subtotal, 160);

  // เปิดโปรที่สองบนสินค้าเดียวกันต้องไม่ได้ — ไม่มีคำตอบว่าอันไหนชนะที่อธิบายลูกค้าได้
  await query(
    `INSERT INTO bms_product_promotions (tenant_id, product_sku, kind, buy_qty, get_qty, active)
     VALUES ($1,$2,'BUY_X_GET_Y',2,1,TRUE)`,
    [tenantId, SKU]
  );
  await assert.rejects(
    () => query(
      `INSERT INTO bms_product_promotions (tenant_id, product_sku, kind, buy_qty, bundle_price, active)
       VALUES ($1,$2,'N_FOR_PRICE',3,100,TRUE)`,
      [tenantId, SKU]
    ),
    /duplicate key|uq_bms_promotions_active_sku/i
  );
});

test("teardown: remove every row this suite created", async () => {
  await query(`DELETE FROM bms_product_promotions WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  if (created.length) {
    await query(`DELETE FROM bms_order_items WHERE order_id = ANY($1::uuid[])`, [created]);
    await query(`DELETE FROM bms_orders WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, created]);
  }
  await query(`DELETE FROM bms_stock_movements WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_inventory WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku = $2`, [tenantId, SKU]);
});
