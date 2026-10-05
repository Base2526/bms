import assert from "node:assert/strict";
import test from "node:test";
import { query, closeDatabasePool } from "../apps/web/lib/db.ts";
import { listProductPromotions, upsertProductPromotion } from "../apps/web/lib/bms/productPromotions.ts";
import { upsertProductPack } from "../apps/web/lib/bms/productPacks.ts";
import { upsertCoupon } from "../apps/web/lib/bms/coupons.ts";
import { resolvePosScan, recordPosSale, openPosShift, upsertPosDevice, partiallyReturnPosSale, returnPosSale } from "../apps/web/lib/bms/pos.ts";

// The suite intentionally keeps evidence for inspection. Never run on a shop database.
function scratchTest(name: string, run: () => Promise<void>, schema: "both" | "legacy" | "gift" = "gift") {
  test(name, { skip: !process.env.POSTGRES_DB?.startsWith("bms_gift_test_")
    ? "Requires a disposable bms_gift_test_* database"
    : schema !== "both" && schema !== (process.env.BMS_GIFT_LEGACY_SCHEMA === "1" ? "legacy" : "gift")
      ? "Different schema test target" : false }, run);
}
const tag = `FAKE-GIFT-${process.pid}`;
const A = `${tag}-A`, B = `${tag}-B`;
let tenantId: string, actor: string, approver: string, branchA: string, branchB: string;
let deviceA: string, deviceB: string, shiftA: string, shiftB: string;
const key = (suffix: string) => `${tag}-${suffix}`;

test.after(async () => { await closeDatabasePool(); });
scratchTest("setup isolated gift products, two branches and distinct approver", async () => {
  const seed = (await query(`SELECT u.tenant_id, u.id FROM users u JOIN roles r ON r.id=u.role_id
    WHERE r.name='Administrator' AND u.tenant_id IS NOT NULL ORDER BY u.created_at LIMIT 1`)).rows[0];
  tenantId = (await query(`INSERT INTO bms_tenants(name,slug) VALUES($1,$2) RETURNING id`,
    [tag, tag.toLowerCase()])).rows[0].id;
  actor = (await query(`INSERT INTO users(name,email,role,password_hash,fake_test,tenant_id,role_id)
    SELECT $2,$3,role,password_hash,TRUE,$4,role_id FROM users WHERE id=$1 RETURNING id`,
    [seed.id, tag, `${tag.toLowerCase()}-cashier@example.invalid`, tenantId])).rows[0].id;
  await query(`INSERT INTO bms_store_profile(tenant_id,vat_registered,price_includes_vat,vat_rate,abbreviated_tax_invoice_approved,tax_id,address)
    VALUES($1,TRUE,TRUE,7,TRUE,'0105555555554','FAKE seller address')`, [tenantId]);
  approver = (await query(`INSERT INTO users(name,email,role,password_hash,fake_test,tenant_id,role_id)
    SELECT $2,$3,role,password_hash,TRUE,tenant_id,role_id FROM users WHERE id=$1 RETURNING id`,
    [actor, tag, `${tag.toLowerCase()}@example.invalid`])).rows[0].id;
  const branches = (await query(`INSERT INTO bms_locations(tenant_id,code,name,branch_code,active,is_head_office)
    VALUES ($1,$2,$2,$4,TRUE,FALSE),($1,$3,$3,$5,TRUE,FALSE) RETURNING id`,
    [tenantId, `${tag}-A`, `${tag}-B`, String(process.pid * 2 % 90000 + 1000), String(process.pid * 2 % 90000 + 1001)])).rows;
  [branchA, branchB] = branches.map((l) => l.id);
  await query(`INSERT INTO bms_products(tenant_id,sku,name,price,active,vat_category)
    VALUES ($1,$2,$2,100,TRUE,'V'),($1,$3,$3,30,TRUE,'N')`, [tenantId, A, B]);
  await query(`INSERT INTO bms_product_sales_surfaces(tenant_id,product_sku,surface,enabled)
    SELECT $1,sku,surface,TRUE FROM unnest($2::text[]) sku CROSS JOIN unnest(ARRAY['RETAIL_POS','RESTAURANT_POS']) surface
    ON CONFLICT (tenant_id,product_sku,surface) DO UPDATE SET enabled=TRUE`, [tenantId, [A, B]]);
  await query(`INSERT INTO bms_inventory(tenant_id,location_id,product_sku,size,current_stock,reserved_stock)
    SELECT $1,$2,sku,'M',100,0 FROM unnest($3::text[]) sku`, [tenantId, branchA, [A, B]]);
  deviceA = (await upsertPosDevice(tenantId, { locationId: branchA, code: `${tag}-A`, active: true })).id;
  deviceB = (await upsertPosDevice(tenantId, { locationId: branchB, code: `${tag}-B`, active: true })).id;
  const sa = await openPosShift({ tenantId, deviceId: deviceA, openedBy: actor, openingFloat: 0 });
  const sb = await openPosShift({ tenantId, deviceId: deviceB, openedBy: actor, openingFloat: 2000 });
  assert.ok("shift" in sa && "shift" in sb);
  shiftA = sa.shift.id; shiftB = sb.shift.id;
}, "both");

const promo = () => ({ tenantId, productSku: A, kind: "BUY_A_GET_B" as const, buyQty: 2, getQty: 1,
  buySize: "M", giftSku: B, giftSize: "M", actorUserId: actor, locationId: branchA });
scratchTest("save, validate conflicts/variants and expose both sides only to eligible branch/surface", async () => {
  await assert.rejects(upsertProductPromotion({ ...promo(), giftSize: "missing" }));
  await upsertProductPromotion(promo());
  await assert.rejects(upsertProductPromotion({ tenantId, productSku: B, kind: "N_FOR_PRICE", buyQty: 2,
    bundlePrice: 20, actorUserId: actor, locationId: branchA }), /ทับซ้อน/);
  for (const sku of [A, B]) {
    assert.equal((await resolvePosScan(tenantId, sku, { size: "M", locationId: branchA }))?.promotion?.kind, "BUY_A_GET_B");
    assert.equal((await resolvePosScan(tenantId, sku, { size: "M", locationId: branchB }))?.promotion, null);
    assert.equal((await resolvePosScan(tenantId, sku, { size: "M", locationId: branchA, surface: "RESTAURANT_POS" }))?.promotion, null);
  }
});

async function sell(suffix: string, a = 4, b = 2, amount = 400, couponCode?: string) {
  const sold = await recordPosSale({ tenantId, deviceId: deviceA, shiftId: shiftA, cashierUserId: actor,
    couponCode,
    idempotencyKey: key(suffix), lines: [{ sku: A, size: "M", packQty: a }, { sku: B, size: "M", packQty: b }],
    payments: [{ method: "CASH", amount, cashTendered: amount }] });
  assert.equal(sold.status, "SOLD", JSON.stringify(sold));
  assert.ok(sold.status === "SOLD");
  const items = (await query(`SELECT id,product_sku,line_amount,pricing_snapshot FROM bms_order_items
    WHERE tenant_id=$1 AND order_id=$2 ORDER BY product_sku`, [tenantId, sold.orderId])).rows;
  return { sold, items: items.map((i) => ({ ...i, id: Number(i.id) })) };
}

scratchTest("before migration: legacy create/update/list/scan/settlement work; new kind refuses clearly", async () => {
  assert.equal((await query(`SELECT count(*)::int AS n FROM pg_attribute
    WHERE attrelid='bms_product_promotions'::regclass AND attname='gift_sku' AND NOT attisdropped`)).rows[0].n, 0);
  const input = { tenantId, productSku: A, locationId: branchA, kind: "N_FOR_PRICE" as const,
    buyQty: 2, bundlePrice: 150, actorUserId: actor };
  const created = await upsertProductPromotion(input);
  const updated = await upsertProductPromotion({ ...input, bundlePrice: 160 });
  assert.equal(updated.id, created.id);
  assert.equal(updated.bundlePrice, 160);
  assert.equal((await listProductPromotions(tenantId))[0].giftSku, null);
  assert.equal((await resolvePosScan(tenantId, A, { size: "M", locationId: branchA }))?.promotion?.kind, "N_FOR_PRICE");
  const { items } = await sell("legacy", 2, 1, 190);
  assert.equal(Number(items[0].line_amount), 160);
  await assert.rejects(upsertProductPromotion(promo()), /10\.41/);
}, "legacy");

scratchTest("gift stock, frozen rules, rejection rollback, cross-branch refund and idempotent replay", async () => {
  const { sold, items } = await sell("frozen");
  assert.equal(Number(items[0].line_amount), 400);
  assert.equal(Number(items[1].line_amount), 0);
  assert.equal(items[0].pricing_snapshot.crossSkuGifts[0].awardedQty, 2);
  await upsertProductPromotion({ ...promo(), buyQty: 20 });
  const base = { tenantId, deviceId: deviceB, shiftId: shiftB, orderId: sold.orderId, actorUserId: actor,
    approvedByUserId: approver, note: "FAKE gift return" };
  const noApproval = await partiallyReturnPosSale({ ...base, approvedByUserId: actor,
    lines: [{ orderItemId: items[0].id, packQty: 1 }], idempotencyKey: key("no-approval") });
  assert.equal(noApproval.status, "CROSS_BRANCH_APPROVAL_REQUIRED");
  const rejected = await partiallyReturnPosSale({ ...base, lines: [{ orderItemId: items[0].id, packQty: 1 }], idempotencyKey: key("no-gift") });
  assert.equal(rejected.status, "GIFT_RETURN_REQUIRED");
  assert.ok(rejected.status === "GIFT_RETURN_REQUIRED");
  assert.equal(rejected.reason.split(B).length - 1, 1, "each missing gift is listed only once");
  assert.equal((await query(`SELECT count(*)::int AS n FROM bms_pos_returns WHERE tenant_id=$1 AND order_id=$2`, [tenantId, sold.orderId])).rows[0].n, 0);
  const input = { ...base, lines: items.map((i) => ({ orderItemId: i.id, packQty: 1 })), idempotencyKey: key("return-pair") };
  const result = await partiallyReturnPosSale(input);
  assert.equal(result.status, "PARTIAL_RETURNED", JSON.stringify(result));
  assert.ok(result.status === "PARTIAL_RETURNED");
  assert.equal(result.refundAmount, 100);
  assert.equal(result.crossBranch, true);
  assert.ok(result.creditNoteNo, "taxable sale must issue a credit note");
  const credit = (await query(`SELECT taxable_amount,exempt_amount,grand_total FROM bms_tax_documents
    WHERE tenant_id=$1 AND doc_no=$2`, [tenantId, result.creditNoteNo])).rows[0];
  assert.equal(Number(credit.taxable_amount), 100);
  assert.equal(Number(credit.exempt_amount), 0, "zero-price non-VAT gift must not receive taxable refund allocation");
  assert.equal(Number(credit.grand_total), 100);
  const returnItems = (await query(`SELECT order_item_id,refund_amount FROM bms_pos_return_items WHERE pos_return_id=$1`, [result.posReturnId])).rows;
  assert.equal(Number(returnItems.find((r) => String(r.order_item_id) === String(items[1].id))?.refund_amount), 0);
  const stock = (await query(`SELECT location_id,product_sku,current_stock FROM bms_inventory WHERE tenant_id=$1 AND product_sku=ANY($2::text[])`, [tenantId, [A, B]])).rows;
  assert.equal(Number(stock.find((r) => r.location_id === branchA && r.product_sku === B)?.current_stock), 98);
  assert.equal(Number(stock.find((r) => r.location_id === branchB && r.product_sku === B)?.current_stock), 1);
  const replay = await partiallyReturnPosSale(input);
  assert.ok(replay.status === "PARTIAL_RETURNED" && replay.replayed);
  const full = await returnPosSale({ ...base, idempotencyKey: key("remaining") });
  assert.equal(full.status, "RETURNED", JSON.stringify(full));
  assert.ok(full.status === "RETURNED");
  assert.equal(full.refundAmount, 300);
});

scratchTest("return gift alone refunds zero; paid extra B can still be refunded", async () => {
  await upsertProductPromotion(promo());
  for (const [suffix, b, amount, refund] of [["gift-only", 1, 200, 0], ["paid-extra", 2, 230, 30]] as const) {
    const { sold, items } = await sell(suffix, 2, b, amount);
    const result = await partiallyReturnPosSale({ tenantId, deviceId: deviceA, shiftId: shiftA,
      orderId: sold.orderId, actorUserId: actor, idempotencyKey: key(`${suffix}-return`),
      lines: [{ orderItemId: items[1].id, packQty: 1 }] });
    assert.equal(result.status, "PARTIAL_RETURNED", JSON.stringify(result));
    assert.ok(result.status === "PARTIAL_RETURNED");
    assert.equal(result.refundAmount, refund);
  }
});

scratchTest("mixed paid and free B retains its paid value when A and the gift are returned", async () => {
  const { sold, items } = await sell("mixed-vat", 2, 2, 230);
  const result = await partiallyReturnPosSale({ tenantId, deviceId: deviceA, shiftId: shiftA,
    orderId: sold.orderId, actorUserId: actor, idempotencyKey: key("mixed-vat-return"),
    lines: [{ orderItemId: items[0].id, packQty: 2 }, { orderItemId: items[1].id, packQty: 1 }] });
  assert.ok(result.status === "PARTIAL_RETURNED", JSON.stringify(result));
  assert.equal(result.refundAmount, 200);
  const credit = (await query(`SELECT taxable_amount,exempt_amount,grand_total FROM bms_tax_documents
    WHERE tenant_id=$1 AND doc_no=$2`, [tenantId, result.creditNoteNo])).rows[0];
  assert.equal(Number(credit.taxable_amount), 200);
  assert.equal(Number(credit.exempt_amount), 0);
  const full = await returnPosSale({ tenantId, deviceId: deviceA, shiftId: shiftA,
    orderId: sold.orderId, actorUserId: actor, idempotencyKey: key("mixed-vat-rest") });
  assert.ok(full.status === "RETURNED", JSON.stringify(full));
  assert.equal(full.refundAmount, 30);
});

scratchTest("named packs coexist with gifts without qualifying or changing their fixed price", async () => {
  await upsertProductPack(tenantId, { productSku: A, size: "M", packCode: "BOX", unitName: "box",
    baseQty: 2, price: 150, isBase: false, active: true });
  const sold = await recordPosSale({ tenantId, deviceId: deviceA, shiftId: shiftA, cashierUserId: actor,
    idempotencyKey: key("pack"), lines: [{ sku: A, size: "M", packCode: "BOX", packQty: 1 },
      { sku: A, size: "M", packQty: 2 }, { sku: B, size: "M", packQty: 1 }],
    payments: [{ method: "CASH", amount: 350, cashTendered: 350 }] });
  assert.ok(sold.status === "SOLD", JSON.stringify(sold));
  const rows = (await query(`SELECT id,pack_code,line_amount,pricing_snapshot FROM bms_order_items
    WHERE tenant_id=$1 AND order_id=$2`, [tenantId, sold.orderId])).rows;
  const pack = rows.find((r) => r.pack_code === "BOX");
  assert.equal(Number(pack.line_amount), 150);
  assert.equal(pack.pricing_snapshot.crossSkuGifts, undefined);
  const returned = await partiallyReturnPosSale({ tenantId, deviceId: deviceA, shiftId: shiftA,
    orderId: sold.orderId, actorUserId: actor, idempotencyKey: key("pack-return"),
    lines: [{ orderItemId: Number(pack.id), packQty: 1 }] });
  assert.ok(returned.status === "PARTIAL_RETURNED", JSON.stringify(returned));
  assert.equal(returned.refundAmount, 150);
});

scratchTest("a refunded paid B cannot replace a free gift on a subsequent cross-branch return", async () => {
  const { sold, items } = await sell("sequential", 2, 2, 230);
  const base = { tenantId, deviceId: deviceB, shiftId: shiftB, orderId: sold.orderId,
    actorUserId: actor, approvedByUserId: approver };
  const first = await partiallyReturnPosSale({ ...base, idempotencyKey: key("sequential-paid"),
    lines: [{ orderItemId: items[1].id, packQty: 1 }] });
  assert.ok(first.status === "PARTIAL_RETURNED", JSON.stringify(first));
  assert.equal(first.refundAmount, 30);
  const denied = await partiallyReturnPosSale({ ...base, idempotencyKey: key("sequential-without-gift"),
    lines: [{ orderItemId: items[0].id, packQty: 2 }] });
  assert.equal(denied.status, "GIFT_RETURN_REQUIRED");
  const last = await returnPosSale({ ...base, idempotencyKey: key("sequential-rest") });
  assert.ok(last.status === "RETURNED", JSON.stringify(last));
  assert.equal(last.refundAmount, 200);
  const credits = (await query(`SELECT SUM(taxable_amount) AS taxable,SUM(exempt_amount) AS exempt,
    SUM(grand_total) AS total FROM bms_tax_documents WHERE tenant_id=$1 AND doc_no=ANY($2::text[])`,
    [tenantId, [first.creditNoteNo, last.creditNoteNo]])).rows[0];
  assert.equal(Number(credits.taxable), 200);
  assert.equal(Number(credits.exempt), 30);
  assert.equal(Number(credits.total), 230);
});

scratchTest("concurrent cross-branch retries refund and restock exactly once", async () => {
  const { sold, items } = await sell("concurrent");
  const input = { tenantId, deviceId: deviceB, shiftId: shiftB, orderId: sold.orderId,
    actorUserId: actor, approvedByUserId: approver, idempotencyKey: key("concurrent-return"),
    lines: items.map((i) => ({ orderItemId: i.id, packQty: 1 })) };
  const results = await Promise.all([partiallyReturnPosSale(input), partiallyReturnPosSale(input)]);
  for (const result of results) {
    assert.ok(result.status === "PARTIAL_RETURNED", JSON.stringify(result));
    assert.equal(result.refundAmount, 100);
  }
  assert.equal(results.filter((r) => r.status === "PARTIAL_RETURNED" && r.replayed).length, 1);
  const notes = results.map((r) => r.status === "PARTIAL_RETURNED" ? r.creditNoteNo : null);
  assert.ok(notes[0]);
  assert.equal(notes[0], notes[1]);
  const written = (await query(`SELECT count(DISTINCT r.id)::int AS returns, SUM(i.refund_amount) AS amount,
    SUM(i.qty)::int AS qty FROM bms_pos_returns r JOIN bms_pos_return_items i ON i.pos_return_id=r.id
    WHERE r.tenant_id=$1 AND r.order_id=$2`, [tenantId, sold.orderId])).rows[0];
  assert.deepEqual([written.returns, Number(written.amount), written.qty], [1, 100, 2]);
});

scratchTest("restaurant sales retain ordinary pricing while the retail gift promotion is active", async () => {
  const sold = await recordPosSale({ tenantId, deviceId: deviceA, shiftId: shiftA, cashierUserId: actor,
    salesSurface: "RESTAURANT_POS", idempotencyKey: key("restaurant"),
    lines: [{ sku: A, size: "M", packQty: 2 }, { sku: B, size: "M", packQty: 1 }],
    payments: [{ method: "CASH", amount: 230, cashTendered: 230 }] });
  assert.ok(sold.status === "SOLD", JSON.stringify(sold));
  const items = (await query(`SELECT line_amount,pricing_snapshot FROM bms_order_items
    WHERE tenant_id=$1 AND order_id=$2 ORDER BY product_sku`, [tenantId, sold.orderId])).rows;
  assert.deepEqual(items.map((i) => Number(i.line_amount)), [200, 30]);
  assert.ok(items.every((i) => !i.pricing_snapshot.crossSkuGifts));
});

scratchTest("order-level coupon and gift returns preserve taxable/exempt totals across partial then full return", async () => {
  const couponCode = key("PERCENT10");
  await upsertCoupon(tenantId, { code: couponCode, type: "PERCENT", value: 10, active: true }, actor);
  const { sold, items } = await sell("coupon", 2, 2, 207, couponCode);
  const base = { tenantId, deviceId: deviceA, shiftId: shiftA, orderId: sold.orderId, actorUserId: actor };
  const first = await partiallyReturnPosSale({ ...base, idempotencyKey: key("coupon-first"),
    lines: [{ orderItemId: items[0].id, packQty: 2 }, { orderItemId: items[1].id, packQty: 1 }] });
  assert.ok(first.status === "PARTIAL_RETURNED", JSON.stringify(first));
  assert.equal(first.refundAmount, 180);
  const credit = (await query(`SELECT taxable_amount,exempt_amount FROM bms_tax_documents
    WHERE tenant_id=$1 AND doc_no=$2`, [tenantId, first.creditNoteNo])).rows[0];
  assert.deepEqual([Number(credit.taxable_amount), Number(credit.exempt_amount)], [180, 0]);
  const last = await returnPosSale({ ...base, idempotencyKey: key("coupon-last") });
  assert.ok(last.status === "RETURNED", JSON.stringify(last));
  assert.equal(last.refundAmount, 27);
});

scratchTest("old preview totals and insufficient gift stock refuse the whole sale without stock writes", async () => {
  const stock = () => query(`SELECT product_sku,current_stock,reserved_stock FROM bms_inventory
    WHERE tenant_id=$1 AND location_id=$2 ORDER BY product_sku`, [tenantId, branchA]);
  const before = (await stock()).rows;
  const input = { tenantId, deviceId: deviceA, shiftId: shiftA, cashierUserId: actor,
    idempotencyKey: key("wrong-total"), lines: [{ sku: A, size: "M", packQty: 2 }, { sku: B, size: "M", packQty: 1 }],
    payments: [{ method: "CASH" as const, amount: 230, cashTendered: 230 }] };
  const mismatch = await recordPosSale(input);
  assert.equal(mismatch.status, "PAYMENT_MISMATCH");
  assert.deepEqual((await stock()).rows, before);
  await query(`UPDATE bms_inventory SET current_stock=0 WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3`, [tenantId, branchA, B]);
  const emptyBefore = (await stock()).rows;
  const insufficient = await recordPosSale({ ...input, idempotencyKey: key("no-gift-stock"), payments: [{ method: "CASH", amount: 200, cashTendered: 200 }] });
  assert.equal(insufficient.status, "INSUFFICIENT", JSON.stringify(insufficient));
  assert.deepEqual((await stock()).rows, emptyBefore);
  assert.equal((await query(`SELECT count(*)::int AS n FROM bms_orders WHERE tenant_id=$1
    AND status='COMPLETED' AND idempotency_key=ANY($2::text[])`, [tenantId, [key("wrong-total"), key("no-gift-stock")]])).rows[0].n, 0);
});
