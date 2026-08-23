// =============================================================
// Quantity-break pricing end to end (8.1)
// -------------------------------------------------------------
// pricing-contract.test.mts proves the arithmetic with no database. This proves
// the part that only a real order can answer: that createOrder actually charges
// the tier price, that the quantity is counted across the whole bill rather than
// per line, and — the one that matters most — that the number the counter screen
// previews and the number createOrder commits are the same.
//
// A disagreement there is not a rounding nuisance. The register sends payment
// rows that must equal the server total exactly; one satang out and the bill is
// voided as PAYMENT_MISMATCH with a customer standing at the counter.
//
// Run from apps/web:
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
//   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit \
//     ../../scripts/price-tiers-db-contract.test.mts
//
// Writes to whatever database it is pointed at. Dev only.
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { createOrder, cancelOrder } from "../apps/web/lib/bms/orders.ts";
import { resolvePosScan } from "../apps/web/lib/bms/pos.ts";
import { unitPriceForQty } from "../apps/web/lib/bms/pricing.ts";

const TAG = "pricetier-test";
const SKU = `FAKE-${TAG}-SKU`;
const SIZE_S = "60ML";
const SIZE_L = "150ML";

let tenantId = "";
let locationId = "";
const createdOrders: string[] = [];

const sell = async (lines: Array<{ size: string; qty: number }>) => {
  const res = await createOrder({
    tenantId,
    channel: "pos",
    locationId,
    items: lines.map((l) => ({ sku: SKU, size: l.size, qty: l.qty })),
  } as any);
  assert.equal(res.status, "CREATED", JSON.stringify(res));
  if (res.status !== "CREATED") throw new Error("unreachable");
  createdOrders.push(res.orderId);
  return res;
};

test("setup: one product at ฿100 with wholesale steps at 3 / 10 / 50", async () => {
  tenantId = (await query<{ id: string }>(`SELECT id FROM bms_tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  locationId = (await query<{ id: string }>(
    `SELECT id FROM bms_locations WHERE tenant_id = $1 AND active
      ORDER BY is_head_office DESC, created_at LIMIT 1`,
    [tenantId]
  )).rows[0].id;

  await query(
    `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category)
     VALUES ($1,$2,$3,100,TRUE,'V')
     ON CONFLICT (tenant_id, sku) DO UPDATE SET price = 100, active = TRUE`,
    [tenantId, SKU, `FAKE ${TAG} product`]
  );
  for (const size of [SIZE_S, SIZE_L]) {
    await query(
      `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
       VALUES ($1,$2,$3,$4,10000,0)
       ON CONFLICT (tenant_id, location_id, product_sku, size)
         DO UPDATE SET current_stock = 10000, reserved_stock = 0`,
      [tenantId, locationId, SKU, size]
    );
  }
  await query(`DELETE FROM bms_product_price_tiers WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  for (const [minQty, price] of [[3, 90], [10, 80], [50, 70]]) {
    await query(
      `INSERT INTO bms_product_price_tiers (tenant_id, product_sku, min_qty, unit_price)
       VALUES ($1,$2,$3,$4)`,
      [tenantId, SKU, minQty, price]
    );
  }
});

test("below the first step the shelf price still applies", async () => {
  const order = await sell([{ size: SIZE_S, qty: 2 }]);
  assert.equal(order.subtotal, 200);
  assert.equal(order.items[0].unitPrice, 100);
});

test("reaching a step charges that step's price for the whole quantity", async () => {
  const order = await sell([{ size: SIZE_S, qty: 3 }]);
  assert.equal(order.items[0].unitPrice, 90);
  assert.equal(order.subtotal, 270, "ขั้นราคาใช้กับทุกชิ้น ไม่ใช่เฉพาะชิ้นที่เกินขั้น");
});

test("the quantity is the whole bill's, not one line's", async () => {
  // 5 + 5 = ซื้อสินค้านั้น 10 ชิ้น → ต้องได้ขั้น 10 ทั้งสองบรรทัด
  const order = await sell([{ size: SIZE_S, qty: 5 }, { size: SIZE_L, qty: 5 }]);
  for (const item of order.items) {
    assert.equal(item.unitPrice, 80, `${item.size} ต้องได้ราคาขั้น 10`);
  }
  assert.equal(order.subtotal, 800);

  // ถ้าคิดต่อบรรทัด ทั้งคู่จะได้ขั้น 3 (฿90) แล้วรวมเป็น 900 — ลูกค้าอธิบายไม่ได้
  assert.notEqual(order.subtotal, 900);
});

test("what the counter previews is what createOrder charges", async () => {
  // จอได้ขั้นราคามาจาก resolvePosScan แล้วคิดเองด้วย unitPriceForQty ตัวเดียวกัน
  const hit = await resolvePosScan(tenantId, SKU, { size: SIZE_S, locationId });
  assert.ok(hit, "ยิง SKU ต้องเจอ");
  assert.equal(hit!.priceTiers.length, 3, "ขั้นราคาต้องถูกส่งไปให้จอ");

  const qty = 12;
  const previewUnit = unitPriceForQty(hit!.basePrice, hit!.priceTiers, qty);
  const previewTotal = previewUnit * qty;

  const order = await sell([{ size: SIZE_S, qty }]);
  assert.equal(order.subtotal, previewTotal,
    "จอกับ server ต่างกันแม้บาทเดียว = บิลถูกตีตก PAYMENT_MISMATCH หน้าลูกค้า");
});

test("re-scanning before payment sees price-tier changes made after the item entered the cart", async () => {
  const stale = await resolvePosScan(tenantId, SKU, { size: SIZE_S, locationId });
  assert.ok(stale);
  assert.equal(unitPriceForQty(stale!.basePrice, stale!.priceTiers, 5), 90);

  // จำลอง Administrator เปลี่ยนขั้นต่ำราคาส่งจาก 3 เป็น 10 ขณะที่ POS มีสินค้าอยู่ในตะกร้า
  await query(`DELETE FROM bms_product_price_tiers WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(
    `INSERT INTO bms_product_price_tiers (tenant_id, product_sku, min_qty, unit_price)
     VALUES ($1,$2,10,80)`,
    [tenantId, SKU]
  );

  const fresh = await resolvePosScan(tenantId, SKU, {
    size: SIZE_S,
    locationId,
    packCode: "BASE",
  });
  assert.ok(fresh);
  assert.equal(fresh!.priceTiers.length, 1);
  assert.equal(fresh!.priceTiers[0].minQty, 10);
  assert.equal(unitPriceForQty(fresh!.basePrice, fresh!.priceTiers, 5), 100,
    "ซื้อ 5 หลังเปลี่ยนขั้นต่ำเป็น 10 ต้องกลับไปใช้ราคาปกติ ไม่ค้างราคาส่งเก่าในตะกร้า");

  const removedPack = await resolvePosScan(tenantId, SKU, {
    size: SIZE_S,
    locationId,
    packCode: "PACK-THAT-NO-LONGER-EXISTS",
  });
  assert.equal(removedPack, null,
    "pack ที่ถูกลบหรือปิดต้องไม่ fallback เป็น BASE แล้วเปลี่ยนสิ่งที่ลูกค้าซื้อเงียบ ๆ");

  // คืน fixture ให้เคสถัดไปเป็นอิสระจาก test นี้
  await query(`DELETE FROM bms_product_price_tiers WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  for (const [minQty, price] of [[3, 90], [10, 80], [50, 70]]) {
    await query(
      `INSERT INTO bms_product_price_tiers (tenant_id, product_sku, min_qty, unit_price)
       VALUES ($1,$2,$3,$4)`,
      [tenantId, SKU, minQty, price]
    );
  }
});

test("removing the steps returns the product to its shelf price", async () => {
  await query(`DELETE FROM bms_product_price_tiers WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  const order = await sell([{ size: SIZE_S, qty: 100 }]);
  assert.equal(order.items[0].unitPrice, 100);
  assert.equal(order.subtotal, 10000);
});

test("saving a product replaces its steps, and omitting the field leaves them alone", async () => {
  const { upsertProduct } = await import("../apps/web/lib/bms/products.ts");
  const base = { sku: SKU, name: `FAKE ${TAG} product`, price: 100, active: true };

  await upsertProduct(tenantId, { ...base, price_tiers: [{ minQty: 5, unitPrice: 85 }] });
  const after = await query<{ min_qty: number; unit_price: string }>(
    `SELECT min_qty, unit_price FROM bms_product_price_tiers
      WHERE tenant_id = $1 AND product_sku = $2 ORDER BY min_qty`,
    [tenantId, SKU]
  );
  assert.equal(after.rowCount, 1, "ส่งมา = แทนที่ทั้งชุด");
  assert.equal(Number(after.rows[0].min_qty), 5);

  // ตัวนำเข้า/ฟอร์มเก่าที่ไม่รู้จักฟิลด์นี้ต้องไม่ล้างขั้นราคาที่ร้านตั้งไว้
  await upsertProduct(tenantId, { ...base, name: "ชื่อใหม่" });
  const kept = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_product_price_tiers WHERE tenant_id = $1 AND product_sku = $2`,
    [tenantId, SKU]
  );
  assert.equal(Number(kept.rows[0].n), 1, "ไม่ส่ง = ไม่แตะ");

  // ส่งอาเรย์ว่าง = ตั้งใจลบทุกขั้น (ลบขั้นสุดท้ายบนจอแล้วกดบันทึก)
  await upsertProduct(tenantId, { ...base, price_tiers: [] });
  const cleared = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_product_price_tiers WHERE tenant_id = $1 AND product_sku = $2`,
    [tenantId, SKU]
  );
  assert.equal(Number(cleared.rows[0].n), 0);

  // ขั้นที่ไม่ถูกต้องถูกคัดทิ้ง ไม่ใช่ทำให้การบันทึกทั้งใบล้ม
  await upsertProduct(tenantId, {
    ...base,
    price_tiers: [{ minQty: 1, unitPrice: 10 }, { minQty: 4, unitPrice: 88 }, { minQty: 4, unitPrice: 77 }],
  });
  const filtered = await query<{ min_qty: number; unit_price: string }>(
    `SELECT min_qty, unit_price FROM bms_product_price_tiers
      WHERE tenant_id = $1 AND product_sku = $2 ORDER BY min_qty`,
    [tenantId, SKU]
  );
  assert.equal(filtered.rowCount, 1, "ขั้น 1 ถูกคัดทิ้ง และขั้นซ้ำเก็บอันแรก");
  assert.equal(Number(filtered.rows[0].min_qty), 4);
  assert.equal(Number(filtered.rows[0].unit_price), 88);
});

test("teardown: remove every row this suite created", async () => {
  for (const id of createdOrders) {
    await cancelOrder(tenantId, id).catch(() => {});
  }
  if (createdOrders.length) {
    await query(`DELETE FROM bms_order_items WHERE order_id = ANY($1::uuid[])`, [createdOrders]);
    await query(`DELETE FROM bms_orders WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, createdOrders]);
  }
  await query(`DELETE FROM bms_product_price_tiers WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_stock_movements WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_inventory WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku = $2`, [tenantId, SKU]);
});
