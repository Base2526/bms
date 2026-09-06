// =============================================================
// Buy-X-get-Y and N-for-a-price, end to end (8.7)
// -------------------------------------------------------------
// pricing-contract.test.mts proves the arithmetic without a database. This proves
// what only a real order can:
//
//   - createOrder charges the promotion price
//   - the promotion is counted once per SKU+size, combining repeated lines of the
//     same variant without mixing variants that have different base prices
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
import { listProductPacks, upsertProductPack } from "../apps/web/lib/bms/productPacks.ts";
import {
  listProductPromotions,
  upsertProductPromotion,
  deactivateProductPromotion,
} from "../apps/web/lib/bms/productPromotions.ts";

const TAG = "promo-test";
const SKU = `FAKE-${TAG}-SKU`;
const SIZE_S = "60ML";
const SIZE_L = "150ML";

let tenantId = "";
let locationId = "";
/** สาขาที่สองที่ชุดนี้สร้างเอง (9.61) — ลบทิ้งตอน teardown */
let branchId = "";
let actorUserId = "";
const created: string[] = [];

const sell = async (lines: Array<{ size: string; qty: number }>, atLocationId?: string) => {
  const res = await createOrder({
    tenantId, channel: "pos", locationId: atLocationId ?? locationId,
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

test("setup: one product with ฿40 and ฿60 size prices", async () => {
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
  await declareSalesSurfaces(SKU, ALL_SURFACES);
  for (const size of [SIZE_S, SIZE_L]) {
    await query(
      `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
       VALUES ($1,$2,$3,$4,500,0)
       ON CONFLICT (tenant_id, location_id, product_sku, size)
         DO UPDATE SET current_stock = 500, reserved_stock = 0`,
      [tenantId, locationId, SKU, size]
    );
  }
  for (const [size, price] of [[SIZE_S, 40], [SIZE_L, 60]] as const) {
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

test("the promotion combines repeated lines but never mixes different size prices", async () => {
  // 2 ขวดเล็ก (฿40) + 2 ขวดใหญ่ (฿60) ยังไม่ครบโปรในแต่ละไซซ์ → ฿200
  const order = await sell([{ size: SIZE_S, qty: 2 }, { size: SIZE_L, qty: 2 }]);
  assert.equal(order.subtotal, 200, "คนละไซซ์ต้องไม่รวมจำนวนหรือใช้ราคาฐานปนกัน");

  const repeated = await sell([{ size: SIZE_S, qty: 2 }, { size: SIZE_S, qty: 2 }]);
  assert.equal(repeated.subtotal, 120, "บรรทัดซ้ำของ SKU+ไซซ์เดียวกันต้องรวมเป็นโปรหนึ่งชุด");
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

test("a fixed-price pack and loose units do not double-count the pack in a promotion", async () => {
  await setPromo(
    `INSERT INTO bms_product_promotions (tenant_id, product_sku, kind, buy_qty, bundle_price)
     VALUES ($1,$2,'N_FOR_PRICE',3,100)`,
    [tenantId, SKU]
  );
  const existing = (await listProductPacks(tenantId, SKU))
    .find((pack) => pack.size === SIZE_S && pack.packCode === "BOX-3");
  await upsertProductPack(tenantId, {
    id: existing?.id,
    productSku: SKU,
    size: SIZE_S,
    packCode: "BOX-3",
    unitName: "กล่อง",
    baseQty: 3,
    price: 90,
    isBase: false,
    active: true,
  });

  const order = await createOrder({
    tenantId,
    channel: "pos",
    locationId,
    items: [
      {
        sku: SKU,
        size: SIZE_S,
        qty: 3,
        packCode: "BOX-3",
        packUnitName: "กล่อง",
        packQty: 1,
        packUnitPrice: 999, // must be replaced by the current catalog price
      },
      { sku: SKU, size: SIZE_S, qty: 3 },
    ],
  } as any);
  assert.equal(order.status, "CREATED", JSON.stringify(order));
  if (order.status !== "CREATED") return;
  created.push(order.orderId);
  assert.equal(order.subtotal, 190,
    "fixed BOX ฿90 + loose 3-for-฿100; pack pieces must not enter or be charged again by the promo");
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


// =============================================================
// 9.61 — แต่ละสาขาตั้งโปรของตัวเองได้อิสระ
// -------------------------------------------------------------
// เทส pure (promotion-branch-scope-contract) ตรึงกติกา "ใครชนะ" ไว้แล้ว · ตรงนี้ตรึง
// สิ่งที่มีแต่บิลจริงเท่านั้นที่พิสูจน์ได้: ตะกร้าเดียวกันเป๊ะ ขายคนละสาขา ได้คนละยอด
// และยอดที่จอพรีวิวตรงกับยอดที่ commit (ไม่งั้น = PAYMENT_MISMATCH ที่หน้าเคาน์เตอร์)
// =============================================================

test("setup 9.61: a second branch that stocks the same product", async () => {
  actorUserId = (await query<{ id: string }>(
    `SELECT id FROM users WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`, [tenantId]
  )).rows[0].id;

  // branch_code default คือ '00000' ซึ่งสงวนให้สำนักงานใหญ่ — ไม่ตั้งเอง = ชนทันที
  branchId = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name, branch_code, is_head_office, active)
     VALUES ($1,$2,$3,$4,FALSE,TRUE)
     ON CONFLICT (tenant_id, code) DO UPDATE SET active = TRUE
     RETURNING id`,
    [tenantId, `FAKE-${TAG}-BR2`, `FAKE ${TAG} branch 2`, `9${TAG.length}871`]
  )).rows[0].id;

  for (const size of [SIZE_S, SIZE_L]) {
    await query(
      `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
       VALUES ($1,$2,$3,$4,500,0)
       ON CONFLICT (tenant_id, location_id, product_sku, size)
         DO UPDATE SET current_stock = 500, reserved_stock = 0`,
      [tenantId, branchId, SKU, size]
    );
  }
});

test("a branch deal overrides the store-wide deal for the same product", async () => {
  await setPromo(
    `INSERT INTO bms_product_promotions (tenant_id, product_sku, kind, buy_qty, bundle_price)
     VALUES ($1,$2,'N_FOR_PRICE',3,100)`,
    [tenantId, SKU]
  );
  // สาขาที่สองจัด "ซื้อ 2 แถม 1" ของตัวเอง ทับโปรทั้งร้านของสินค้าตัวเดียวกัน
  await upsertProductPromotion({
    tenantId, actorUserId, productSku: SKU, locationId: branchId,
    kind: "BUY_X_GET_Y", buyQty: 2, getQty: 1,
  });

  // ตะกร้าเดียวกันเป๊ะ: 3 ชิ้นไซซ์เล็ก (ราคาป้าย ฿40)
  assert.equal((await sell([{ size: SIZE_S, qty: 3 }])).subtotal, 100,
    "สำนักงานใหญ่ไม่ได้ตั้งโปรเอง จึงยังได้ 3 ชิ้น 100 ของทั้งร้าน");
  assert.equal((await sell([{ size: SIZE_S, qty: 3 }], branchId)).subtotal, 80,
    "สาขาที่ตั้งโปรเองต้องได้ซื้อ 2 แถม 1 = จ่าย 2 ชิ้น");
});

test("the register preview at a branch matches what the bill commits", async () => {
  // ถ้าสองฝั่งเลือกโปรคนละแถว บิลถูกทิ้งทั้งใบด้วย PAYMENT_MISMATCH หน้าลูกค้า
  for (const [where, expected] of [[locationId, 100], [branchId, 80]] as const) {
    const hit = await resolvePosScan(tenantId, SKU, { size: SIZE_S, locationId: where });
    assert.ok(hit, "resolvePosScan ต้องเจอสินค้า");
    const preview = applyPromotion(hit!.packPrice, 3, hit!.promotion);
    assert.equal(preview.amount, expected, `จอของสาขานี้ต้องพรีวิวได้ ${expected}`);
    assert.equal((await sell([{ size: SIZE_S, qty: 3 }], where)).subtotal, preview.amount,
      "ยอดที่จอโชว์กับยอดที่ commit ต้องเท่ากันเสมอ");
  }
});

test("a branch deal never leaks into another branch", async () => {
  const atHq = await resolvePosScan(tenantId, SKU, { size: SIZE_S, locationId });
  assert.equal(atHq?.promotion?.kind, "N_FOR_PRICE", "สำนักงานใหญ่ต้องไม่เห็นโปรของสาขาที่สอง");
  const atBranch = await resolvePosScan(tenantId, SKU, { size: SIZE_S, locationId: branchId });
  assert.equal(atBranch?.promotion?.kind, "BUY_X_GET_Y");

  // เส้นทางที่ไม่รู้สาขา (เช่นการค้นบิลย้อนหลัง) ต้องได้แค่โปรทั้งร้าน
  const noBranch = await resolvePosScan(tenantId, SKU, { size: SIZE_S, locationId: null });
  assert.equal(noBranch?.promotion?.kind, "N_FOR_PRICE");
});

test("one active deal per scope — but store-wide and branch may coexist", async () => {
  // นี่คือทั้งหมดของ 9.61: สองแถวนี้อยู่ด้วยกันได้ ต่างจากดัชนีเดิมของ 8.7
  const scoped = await listProductPromotions(tenantId, { productSku: SKU });
  assert.equal(scoped.length, 2, "ต้องมีโปรทั้งร้าน 1 + โปรของสาขา 1 อยู่พร้อมกัน");

  await assert.rejects(
    () => query(
      `INSERT INTO bms_product_promotions (tenant_id, product_sku, location_id, kind, buy_qty, bundle_price, active)
       VALUES ($1,$2,$3,'N_FOR_PRICE',3,100,TRUE)`,
      [tenantId, SKU, branchId]
    ),
    /duplicate key|uq_bms_promotions_active_sku_branch/i,
    "สาขาเดียวกันมีโปร active สองแบบไม่ได้"
  );
  await assert.rejects(
    () => query(
      `INSERT INTO bms_product_promotions (tenant_id, product_sku, kind, buy_qty, get_qty, active)
       VALUES ($1,$2,'BUY_X_GET_Y',2,1,TRUE)`,
      [tenantId, SKU]
    ),
    /duplicate key|uq_bms_promotions_active_sku_store/i,
    "โปรทั้งร้าน active สองแบบก็ยังไม่ได้เหมือนเดิม"
  );
});

test("saving the same scope again edits the deal instead of adding a second", async () => {
  const before = (await listProductPromotions(tenantId, { productSku: SKU })).length;
  const saved = await upsertProductPromotion({
    tenantId, actorUserId, productSku: SKU, locationId: branchId,
    kind: "N_FOR_PRICE", buyQty: 2, bundlePrice: 70,
  });
  const after = await listProductPromotions(tenantId, { productSku: SKU });
  assert.equal(after.length, before, "บันทึกซ้ำในขอบเขตเดิมต้องไม่งอกแถวที่สอง");
  assert.equal(saved.kind, "N_FOR_PRICE");
  assert.equal((await sell([{ size: SIZE_S, qty: 2 }], branchId)).subtotal, 70,
    "โปรที่แก้แล้วต้องมีผลกับบิลถัดไปทันที");
});

test("stopping a branch deal falls back to the store-wide one, and keeps the record", async () => {
  const branchDeal = (await listProductPromotions(tenantId, { productSku: SKU }))
    .find((row) => row.locationId === branchId);
  assert.ok(branchDeal, "ต้องมีโปรของสาขาให้ปิด");
  assert.equal(await deactivateProductPromotion({ tenantId, id: branchDeal!.id, actorUserId }), true);

  assert.equal((await sell([{ size: SIZE_S, qty: 3 }], branchId)).subtotal, 100,
    "ปิดโปรของสาขาแล้วต้องตกกลับไปใช้โปรทั้งร้าน ไม่ใช่ไม่มีโปรเลย");
  const stopped = await listProductPromotions(tenantId, { productSku: SKU, includeInactive: true });
  assert.ok(stopped.some((row) => row.id === branchDeal!.id && !row.active),
    "โปรที่ปิดแล้วต้องยังอยู่ให้ไล่ได้ว่าสาขาไหนจัดอะไรช่วงไหน");
});

test("a promotion cannot point at another shop's branch", async () => {
  const otherLocation = (await query<{ id: string }>(
    `SELECT id FROM bms_locations WHERE tenant_id <> $1 LIMIT 1`, [tenantId]
  )).rows[0]?.id;
  if (!otherLocation) return; // ฐานนี้มีร้านเดียว ไม่มีอะไรให้ทดสอบ
  await assert.rejects(
    () => query(
      `INSERT INTO bms_product_promotions (tenant_id, product_sku, location_id, kind, buy_qty, get_qty)
       VALUES ($1,$2,$3,'BUY_X_GET_Y',2,1)`,
      [tenantId, SKU, otherLocation]
    ),
    /foreign key|bms_product_promotions_location_fk/i
  );
});

test("teardown: remove every row this suite created", async () => {
  await query(`DELETE FROM bms_product_promotions WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  if (created.length) {
    await query(`DELETE FROM bms_order_items WHERE order_id = ANY($1::uuid[])`, [created]);
    await query(`DELETE FROM bms_orders WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, created]);
  }
  await query(`DELETE FROM bms_stock_movements WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_product_packs WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_inventory WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku = $2`, [tenantId, SKU]);
  if (branchId) {
    await query(`DELETE FROM bms_locations WHERE tenant_id = $1 AND id = $2`, [tenantId, branchId]);
  }
  const leftovers = (await query<{ n: string }>(
    `SELECT count(*) AS n FROM bms_locations WHERE tenant_id = $1 AND code LIKE 'FAKE-%'`, [tenantId]
  )).rows[0].n;
  assert.equal(Number(leftovers), 0, "สาขาทดสอบต้องไม่ค้างอยู่ในฐาน");
});
