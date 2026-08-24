// =============================================================
// Quantity-break pricing end to end (8.1)
// -------------------------------------------------------------
// pricing-contract.test.mts proves the arithmetic with no database. This proves
// the part that only a real order can answer: that createOrder actually charges
// the tier price, that repeated SKU+size lines are counted together without mixing
// different size prices, and — the one that matters most — that the number the counter screen
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
import { listProductPacks, upsertProductPack } from "../apps/web/lib/bms/productPacks.ts";
import { unitPriceForQty } from "../apps/web/lib/bms/pricing.ts";
import { listSellableProducts } from "../apps/web/lib/bms/products.ts";
import { generateQuotation } from "../apps/web/lib/bms/documents.ts";
import { getInventorySummary } from "../apps/web/lib/bms/reports.ts";

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

test("per-size BASE price is identical in POS and committed order", async () => {
  for (const [size, price] of [[SIZE_S, 120], [SIZE_L, 200]] as const) {
    const existing = (await listProductPacks(tenantId, SKU)).find((pack) => pack.size === size && pack.isBase);
    await upsertProductPack(tenantId, {
      id: existing?.id,
      productSku: SKU,
      size,
      packCode: "BASE",
      unitName: "ชิ้น",
      baseQty: 1,
      price,
      isBase: true,
      active: true,
    });
  }

  const smallHit = await resolvePosScan(tenantId, SKU, { size: SIZE_S, locationId });
  const largeHit = await resolvePosScan(tenantId, SKU, { size: SIZE_L, locationId });
  assert.equal(smallHit?.basePrice, 120);
  assert.equal(largeHit?.basePrice, 200);
  assert.equal(smallHit?.packPrice, 120, "BASE pack ต้องไม่หยิบราคาของไซซ์อื่น");
  assert.equal(largeHit?.packPrice, 200, "BASE pack ต้องตรงกับ basePrice ของไซซ์ที่เลือก");

  const order = await sell([{ size: SIZE_S, qty: 2 }, { size: SIZE_L, qty: 2 }]);
  assert.equal(order.subtotal, 640);
  assert.equal(order.items.find((item) => item.size === SIZE_S)?.unitPrice, 120);
  assert.equal(order.items.find((item) => item.size === SIZE_L)?.unitPrice, 200);

  const smallBudget = await listSellableProducts(tenantId, {
    search: SKU, size: SIZE_S, maxPrice: 150, inStockOnly: true, locationId,
  });
  const largeBudget = await listSellableProducts(tenantId, {
    search: SKU, size: SIZE_L, maxPrice: 150, inStockOnly: true, locationId,
  });
  assert.equal(smallBudget.items[0]?.sku, SKU, "ไซซ์ ฿120 ต้องผ่านงบไม่เกิน ฿150");
  assert.equal(largeBudget.items.length, 0, "ไซซ์ ฿200 ต้องไม่ผ่านงบไม่เกิน ฿150");

  const quotation = await generateQuotation(tenantId, [{ sku: SKU, size: SIZE_L, qty: 2 }]);
  assert.equal(quotation.lines[0]?.unitPrice, 200);
  assert.equal(quotation.subtotal, 400, "ใบเสนอราคาต้องใช้ราคาไซซ์ ไม่ใช่ราคาหลัก ฿100");

  const stockValueBefore = (await getInventorySummary(tenantId)).stockValue;
  const largeBase = (await listProductPacks(tenantId, SKU)).find((pack) => pack.size === SIZE_L && pack.isBase);
  await upsertProductPack(tenantId, {
    id: largeBase?.id,
    productSku: SKU,
    size: SIZE_L,
    packCode: "BASE",
    unitName: "ชิ้น",
    baseQty: 1,
    price: 210,
    isBase: true,
    active: true,
  });
  const stockValueAfter = (await getInventorySummary(tenantId)).stockValue;
  assert.equal(stockValueAfter - stockValueBefore, 100_000,
    "สต็อกไซซ์ L 10,000 ชิ้นเพิ่มราคาชิ้นละ ฿10 มูลค่ารวมต้องเพิ่ม ฿100,000");

  await query(`DELETE FROM bms_product_price_tiers WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(
    `INSERT INTO bms_product_price_tiers
       (tenant_id, product_sku, min_qty, unit_price, scope, discount_pct)
     VALUES ($1,$2,10,NULL,'CROSS_VARIANT_PERCENT',20)`,
    [tenantId, SKU]
  );
  const smallCrossHit = await resolvePosScan(tenantId, SKU, { size: SIZE_S, locationId });
  const largeCrossHit = await resolvePosScan(tenantId, SKU, { size: SIZE_L, locationId });
  assert.equal(unitPriceForQty(smallCrossHit!.basePrice, smallCrossHit!.priceTiers, 4, 10), 96);
  assert.equal(unitPriceForQty(largeCrossHit!.basePrice, largeCrossHit!.priceTiers, 6, 10), 168);
  const crossSizeOrder = await sell([{ size: SIZE_S, qty: 4 }, { size: SIZE_L, qty: 6 }]);
  assert.equal(crossSizeOrder.subtotal, 1_392,
    "รวมครบ 10 ชิ้นต้องลด 20% จากราคาไซซ์ S ฿120 และ L ฿210 แยกกัน");
  const crossSizeQuote = await generateQuotation(tenantId, [
    { sku: SKU, size: SIZE_S, qty: 4 },
    { sku: SKU, size: SIZE_L, qty: 6 },
  ]);
  assert.equal(crossSizeQuote.subtotal, crossSizeOrder.subtotal,
    "ใบเสนอราคาจำนวนเดียวกันต้องใช้ราคาส่งตรงกับออร์เดอร์");

  await query(`DELETE FROM bms_product_price_tiers WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  for (const [minQty, price] of [[3, 90], [10, 80], [50, 70]]) {
    await query(
      `INSERT INTO bms_product_price_tiers (tenant_id, product_sku, min_qty, unit_price)
       VALUES ($1,$2,$3,$4)`,
      [tenantId, SKU, minQty, price]
    );
  }

  for (const size of [SIZE_S, SIZE_L]) {
    const existing = (await listProductPacks(tenantId, SKU)).find((pack) => pack.size === size && pack.isBase);
    await upsertProductPack(tenantId, {
      id: existing?.id,
      productSku: SKU,
      size,
      packCode: "BASE",
      unitName: "ชิ้น",
      baseQty: 1,
      price: null,
      isBase: true,
      active: true,
    });
  }
});

test("reaching a step charges that step's price for the whole quantity", async () => {
  const order = await sell([{ size: SIZE_S, qty: 3 }]);
  assert.equal(order.items[0].unitPrice, 90);
  assert.equal(order.subtotal, 270, "ขั้นราคาใช้กับทุกชิ้น ไม่ใช่เฉพาะชิ้นที่เกินขั้น");
});

test("quantity tiers do not combine different sizes", async () => {
  // แต่ละไซซ์มี 5 ชิ้น จึงได้ขั้น 3 แยกกัน ไม่รวมเป็น 10
  const order = await sell([{ size: SIZE_S, qty: 5 }, { size: SIZE_L, qty: 5 }]);
  for (const item of order.items) {
    assert.equal(item.unitPrice, 90, `${item.size} ต้องได้ราคาขั้น 3`);
  }
  assert.equal(order.subtotal, 900);
});

test("same minimum can persist different fixed wholesale prices per size", async () => {
  const { upsertProduct } = await import("../apps/web/lib/bms/products.ts");
  const base = { sku: SKU, name: `FAKE ${TAG} product`, price: 100, active: true };
  await upsertProduct(tenantId, {
    ...base,
    price_tiers: [
      { minQty: 5, scope: "PER_VARIANT_FIXED", size: SIZE_S, unitPrice: 82 },
      { minQty: 5, scope: "PER_VARIANT_FIXED", size: SIZE_L, unitPrice: 76 },
    ],
  });

  const smallHit = await resolvePosScan(tenantId, SKU, { size: SIZE_S, locationId });
  const largeHit = await resolvePosScan(tenantId, SKU, { size: SIZE_L, locationId });
  assert.equal(unitPriceForQty(smallHit!.basePrice, smallHit!.priceTiers, 5, 5, SIZE_S), 82);
  assert.equal(unitPriceForQty(largeHit!.basePrice, largeHit!.priceTiers, 5, 5, SIZE_L), 76);

  const order = await sell([{ size: SIZE_S, qty: 5 }, { size: SIZE_L, qty: 5 }]);
  assert.equal(order.items.find((item) => item.size === SIZE_S)?.unitPrice, 82);
  assert.equal(order.items.find((item) => item.size === SIZE_L)?.unitPrice, 76);
  assert.equal(order.subtotal, 790, "POS preview and committed order must use the same size rule");

  await upsertProduct(tenantId, {
    ...base,
    price_tiers: [
      { minQty: 3, unitPrice: 90 },
      { minQty: 10, unitPrice: 80 },
      { minQty: 50, unitPrice: 70 },
    ],
  });
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

  await upsertProduct(tenantId, {
    ...base,
    price_tiers: [{
      minQty: 10,
      scope: "CROSS_VARIANT_PERCENT",
      unitPrice: null,
      discountPct: 13.3333,
    }],
  });
  const cross = await query<{ scope: string; unit_price: string | null; discount_pct: string | null }>(
    `SELECT scope, unit_price, discount_pct FROM bms_product_price_tiers
      WHERE tenant_id = $1 AND product_sku = $2`,
    [tenantId, SKU]
  );
  assert.deepEqual(cross.rows[0], {
    scope: "CROSS_VARIANT_PERCENT",
    unit_price: null,
    discount_pct: "13.3333",
  }, "ฟอร์มรวมข้ามไซซ์ต้องเก็บเปอร์เซ็นต์ละเอียดพอสำหรับคำนวณราคาต่อไซซ์");

  await assert.rejects(
    () => query(
      `INSERT INTO bms_product_price_tiers
         (tenant_id, product_sku, min_qty, unit_price, scope, discount_pct)
       VALUES ($1,$2,999,NULL,'CROSS_VARIANT_PERCENT',NULL)`,
      [tenantId, SKU]
    ),
    /bms_product_price_tiers_value_check/,
    "DB ต้องไม่รับ cross-size tier ที่ไม่มีเปอร์เซ็นต์"
  );

  // ส่งอาเรย์ว่าง = ตั้งใจลบทุกขั้น (ลบขั้นสุดท้ายบนจอแล้วกดบันทึก)
  await upsertProduct(tenantId, { ...base, price_tiers: [] });
  const cleared = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_product_price_tiers WHERE tenant_id = $1 AND product_sku = $2`,
    [tenantId, SKU]
  );
  assert.equal(Number(cleared.rows[0].n), 0);

  await upsertProduct(tenantId, { ...base, price_tiers: [{ minQty: 4, unitPrice: 88 }] });
  await assert.rejects(() => upsertProduct(tenantId, {
    ...base,
    price_tiers: [{ minQty: 4, scope: "PER_VARIANT_FIXED", unitPrice: null }],
  }), /ห้ามว่าง/, "ราคาคงที่ที่ส่ง null ต้องไม่ถูกแปลงเป็นราคาฟรี");
  await assert.rejects(() => upsertProduct(tenantId, {
    ...base,
    price_tiers: [{ minQty: 1, unitPrice: 10 }, { minQty: 4, unitPrice: 77 }],
  }), /ขั้นต่ำราคาส่ง/, "ข้อมูลผิดรูปต้องแจ้ง error ไม่ใช่ลบหรือข้ามแถวเงียบ ๆ");
  const preserved = await query<{ min_qty: number; unit_price: string }>(
    `SELECT min_qty, unit_price FROM bms_product_price_tiers
      WHERE tenant_id = $1 AND product_sku = $2 ORDER BY min_qty`,
    [tenantId, SKU]
  );
  assert.equal(preserved.rowCount, 1);
  assert.equal(Number(preserved.rows[0].min_qty), 4);
  assert.equal(Number(preserved.rows[0].unit_price), 88,
    "บันทึกที่ validation ไม่ผ่านต้องคงชุดราคาส่งเดิมทั้งหมด");
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
