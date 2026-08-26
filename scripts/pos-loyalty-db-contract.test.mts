// =============================================================
// POS counter sale with membership — end to end against a real Postgres
// -------------------------------------------------------------
// loyalty-db-contract.test.mts proves the ledger. This one drives the actual
// counter path: device token, cashier PIN, open shift, recordPosSale with a
// member + coupon + points, replay the same idempotency key, partial return,
// then close the shift. That is the sequence a register performs, and it is the
// only way to see the receipt fields, the cash rounding, and the abbreviated tax
// document line up with the ledger.
//
// Run from apps/web:
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app \
//   POSTGRES_PASSWORD=... REDIS_URL=redis://127.0.0.1:6379 \
//   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit ../../scripts/pos-loyalty-db-contract.test.mts
//
// Writes to whatever database it is pointed at. Dev only.
//
// ⚠️ ต้องใช้ --test-concurrency=1 เมื่อรันคู่กับไฟล์เทส DB อื่น — ทั้งสองชุดใช้ร้าน
// แรกในฐานร่วมกันและแก้ bms_loyalty_settings/ชั้นสมาชิกของร้านนั้น ถ้า node:test
// รันสองไฟล์ขนานกันจะเหยียบกันเอง (เจอมาแล้ว: fail 7 รอบแรก ผ่านหมดรอบสอง)
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import {
  authenticatePosDevice,
  closePosShift,
  issuePosDeviceToken,
  listRecentPosSales,
  openPosShift,
  partiallyReturnPosSale,
  recordPosSale,
  setCashierPin,
  upsertPosDevice,
} from "../apps/web/lib/bms/pos.ts";
import {
  adjustPoints,
  enrollMember,
  getMember,
  listOrderDiscounts,
  updateLoyaltySettings,
  upsertMembershipTier,
} from "../apps/web/lib/bms/membership.ts";
import { upsertCoupon } from "../apps/web/lib/bms/coupons.ts";

const TAG = "pos-loyalty-test";
const SKU = `FAKE-${TAG}-SKU`;
const SIZE = "M";
const PIN = "4821";

let tenantId = "";
let locationId = "";
let deviceId = "";
let deviceToken = "";
let cashierId = "";
let shiftId = "";
let memberId = "";
let tierId = "";
let soldOrderId = "";

const key = (n: string) => `${TAG}-${n}-${process.pid}`;

test("setup: shop, product, register, cashier PIN, member with points", async () => {
  const t = await query<{ id: string }>(`SELECT id FROM bms_tenants ORDER BY created_at LIMIT 1`);
  tenantId = t.rows[0].id;

  const loc = await query<{ id: string }>(
    `SELECT id FROM bms_locations WHERE tenant_id = $1 AND active
      ORDER BY is_head_office DESC, created_at LIMIT 1`,
    [tenantId]
  );
  assert.ok(loc.rows[0], "ต้องมีสาขา (7.84)");
  locationId = loc.rows[0].id;

  // ปิดปัดเศษเงินสดเพื่อให้ยอดที่คาดไว้เป็นเลขตรง — ค่านี้อยู่ใน bms_store_profile
  // (ไม่มีตาราง VAT settings แยก ดู getVatSettings)
  await query(
    `UPDATE bms_store_profile SET cash_rounding = 'NONE' WHERE tenant_id = $1`,
    [tenantId]
  );
  await updateLoyaltySettings(tenantId, {
    enabled: true, earnMode: "SPEND", earnPointsPerBaht: 1, earnMinSpend: 0,
    earnBase: "AFTER_DISCOUNT", redeemPointsPerUnit: 100, redeemBahtPerUnit: 10,
    redeemMinPoints: 100, maxDiscountPct: 100, pointsExpireMonths: 24,
  });

  await query(
    `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category)
     VALUES ($1,$2,$3,100,TRUE,'V')
     ON CONFLICT (tenant_id, sku) DO UPDATE SET price = 100, active = TRUE`,
    [tenantId, SKU, `FAKE ${TAG} product`]
  );
  await query(
    `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
     VALUES ($1,$2,$3,$4,10000,0)
     ON CONFLICT (tenant_id, location_id, product_sku, size)
       DO UPDATE SET current_stock = 10000, reserved_stock = 0`,
    [tenantId, locationId, SKU, SIZE]
  );

  const device = await upsertPosDevice(tenantId, {
    locationId, code: `${TAG}-REG`, name: `FAKE ${TAG} register`, active: true,
  });
  deviceId = device.id;
  const issued = await issuePosDeviceToken(tenantId, deviceId);
  assert.ok(issued, "ต้องออก token ให้เครื่องได้");
  deviceToken = issued!.token;

  // token ต้องใช้ยืนยันตัวเครื่องได้และผูกกับร้าน/สาขาที่ถูก
  const authed = await authenticatePosDevice(deviceToken);
  assert.equal(authed?.tenantId, tenantId);
  assert.equal(authed?.id, deviceId);

  // แคชเชียร์: ต้องมีสิทธิ์ pos.sell จริงผ่าน role ไม่ใช่ bypass
  const cashier = await query<{ id: string }>(
    `SELECT u.id FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE u.tenant_id = $1
        AND EXISTS (
          SELECT 1 FROM bms_role_permissions rp
           WHERE rp.tenant_id = u.tenant_id AND rp.role_id = u.role_id AND rp.permission = 'pos.sell'
        )
      ORDER BY u.created_at
      LIMIT 1`,
    [tenantId]
  );
  if (!cashier.rowCount) {
    // Administrator เป็น super role — ไม่มีแถวใน bms_role_permissions
    const admin = await query<{ id: string }>(
      `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.tenant_id = $1 AND r.name = 'Administrator'
        ORDER BY u.created_at LIMIT 1`,
      [tenantId]
    );
    assert.ok(admin.rows[0], "ต้องมีผู้ใช้ที่ขายหน้าร้านได้อย่างน้อย 1 คน");
    cashierId = admin.rows[0].id;
  } else {
    cashierId = cashier.rows[0].id;
  }
  await setCashierPin(tenantId, cashierId, PIN);

  tierId = (await upsertMembershipTier(tenantId, {
    code: `${TAG}-TIER`, name: "POS Test Tier", discountType: "PERCENT", discountValue: 5,
    qualifySpend12m: 0, qualifyPoints: 0, sortOrder: 40, active: true,
  })).id;
  await upsertCoupon(tenantId, {
    code: `${TAG.toUpperCase()}-C100`, type: "FIXED", value: 100, active: true,
    minOrderAmount: null, maxRedemptions: null, perCustomerLimit: 1,
    startsAt: null, expiresAt: null, note: `FAKE ${TAG}`,
  } as any);

  const enrolled = await enrollMember(tenantId, {
    phone: `0955${String(Date.now()).slice(-6)}`, name: `FAKE ${TAG} member`,
  });
  assert.notEqual(enrolled.status, "INVALID");
  if (enrolled.status === "INVALID") return;
  memberId = enrolled.member.customerId;
  await query(`UPDATE bms_customers SET tier_id = $3 WHERE tenant_id = $1 AND id = $2`,
    [tenantId, memberId, tierId]);
  await adjustPoints({ tenantId, customerId: memberId, points: 320, note: `${TAG} seed` });
});

test("open shift", async () => {
  const res = await openPosShift({ tenantId, deviceId, openedBy: cashierId, openingFloat: 1000 });
  assert.ok(res.status === "OPENED" || res.status === "ALREADY_OPEN", JSON.stringify(res));
  if (res.status === "OPENED" || res.status === "ALREADY_OPEN") shiftId = res.shift.id;
});

test("counter sale: tier + coupon + points on one bill, receipt agrees with the ledger", async () => {
  // 10 × 100 = 1000 · tier 5% = 50 · คูปอง 100 · แลก 200 แต้ม = 20 → เก็บ 830
  const sale = await recordPosSale({
    tenantId,
    deviceId,
    shiftId,
    cashierUserId: cashierId,
    idempotencyKey: key("sale-1"),
    lines: [{ sku: SKU, size: SIZE, packQty: 10 }],
    payments: [{ method: "CASH", amount: 830, cashTendered: 1000 }],
    customerId: memberId,
    pointsToRedeem: 200,
    couponCode: `${TAG.toUpperCase()}-C100`,
  });
  assert.equal(sale.status, "SOLD", JSON.stringify(sale));
  if (sale.status !== "SOLD") return;
  soldOrderId = sale.orderId;

  assert.equal(sale.total, 830, "ยอดที่เก็บต้องเป็นยอดหลังส่วนลดทุกชั้น");
  assert.equal(sale.cashChange, 170);
  assert.equal(sale.replayed, false);

  // ตัวเลขสมาชิกบนใบเสร็จ: ได้แต้มจากยอดหลังส่วนลด (830) และคงเหลือ = 120 + 830
  assert.equal(sale.pointsEarned, 830);
  assert.equal(sale.pointsBalance, 950);

  // ส่วนลดแยกบรรทัดสำหรับพิมพ์ และผลรวมต้องเท่ากับ discount_amount ของบิล
  const sources = (sale.discountLines ?? []).map((l) => l.source).sort();
  assert.deepEqual(sources, ["COUPON", "POINTS", "TIER"], JSON.stringify(sale.discountLines));
  const sum = (sale.discountLines ?? []).reduce((n, l) => n + l.amount, 0);
  assert.equal(Math.round(sum * 100) / 100, 170);

  const order = await query<{ discount_amount: string; total_amount: string; status: string; customer_id: string }>(
    `SELECT discount_amount, total_amount, status, customer_id FROM bms_orders WHERE tenant_id = $1 AND id = $2`,
    [tenantId, soldOrderId]
  );
  assert.equal(Number(order.rows[0].discount_amount), 170);
  assert.equal(Number(order.rows[0].total_amount), 830);
  assert.equal(order.rows[0].status, "COMPLETED");
  assert.equal(order.rows[0].customer_id, memberId, "บิล POS ต้องผูกลูกค้าแล้ว (เดิมเป็น NULL ทุกใบ)");

  // ใบกำกับอย่างย่อ (ถ้าร้านจด VAT) ต้องคิดฐานจากยอดหลังส่วนลด ไม่ใช่ 1000
  if (sale.vat) {
    const vatBase = sale.vat.taxableAmount + sale.vat.exemptAmount;
    assert.equal(Math.round(vatBase * 100) / 100, 830,
      "ฐานภาษีต้องมาจากยอดหลังหักส่วนลดทุกชั้น");
  }
});

test("replaying the same idempotency key returns the same bill and grants no second earn", async () => {
  const replay = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("sale-1"),
    lines: [{ sku: SKU, size: SIZE, packQty: 10 }],
    payments: [{ method: "CASH", amount: 830, cashTendered: 1000 }],
    customerId: memberId, pointsToRedeem: 200,
    couponCode: `${TAG.toUpperCase()}-C100`,
  });
  assert.equal(replay.status, "SOLD");
  if (replay.status !== "SOLD") return;
  assert.equal(replay.orderId, soldOrderId, "ต้องได้บิลเดิม ไม่ใช่บิลใหม่");
  assert.equal(replay.replayed, true);
  assert.equal(replay.pointsEarned, 830, "ยิงซ้ำต้องรายงานแต้มเดิม ไม่ใช่ 0");

  assert.equal((await getMember(tenantId, memberId))?.pointsUsable, 950, "แต้มต้องไม่เพิ่มรอบสอง");
  const earnRows = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM bms_loyalty_ledger
      WHERE tenant_id = $1 AND order_id = $2 AND kind = 'EARN'`,
    [tenantId, soldOrderId]
  );
  assert.equal(Number(earnRows.rows[0].n), 1);
});

test("the per-customer coupon limit now applies at the counter", async () => {
  // นี่คือช่องรั่วเดิม: บิล POS ไม่ผูกลูกค้า ทำให้ per_customer_limit ไม่มีผลเลย
  const again = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("sale-coupon-again"),
    lines: [{ sku: SKU, size: SIZE, packQty: 5 }],
    payments: [{ method: "CASH", amount: 375, cashTendered: 400 }],
    customerId: memberId,
    couponCode: `${TAG.toUpperCase()}-C100`,
  });
  assert.equal(again.status, "COUPON_INVALID", JSON.stringify(again));
});

test("redeeming more than the member holds is refused at the counter too", async () => {
  const res = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("sale-short"),
    lines: [{ sku: SKU, size: SIZE, packQty: 1 }],
    payments: [{ method: "CASH", amount: 100, cashTendered: 100 }],
    customerId: memberId, pointsToRedeem: 99_000,
  });
  assert.equal(res.status, "POINTS_INVALID", JSON.stringify(res));
  assert.equal((await getMember(tenantId, memberId))?.pointsUsable, 950, "ปฏิเสธแล้วแต้มต้องไม่ขยับ");
});

test("partial return: half the bill reverses half the points both ways", async () => {
  const items = await query<{ id: string }>(
    `SELECT id FROM bms_order_items WHERE tenant_id = $1 AND order_id = $2 ORDER BY id`,
    [tenantId, soldOrderId]
  );
  assert.ok(items.rows[0]);

  const ret = await partiallyReturnPosSale({
    tenantId,
    deviceId,
    orderId: soldOrderId,
    actorUserId: cashierId,
    lines: [{ orderItemId: Number(items.rows[0].id), packQty: 5 }],
    note: `${TAG} partial`,
    idempotencyKey: key("ret-1"),
  });
  assert.equal(ret.status, "PARTIAL_RETURNED", JSON.stringify(ret));
  if (ret.status !== "PARTIAL_RETURNED") return;

  assert.equal(ret.refundAmount, 415, "คืนครึ่งบิลของยอดสุทธิ 830");
  assert.equal(ret.pointsReversed, 415, "ดึงแต้มที่ได้คืนครึ่งหนึ่ง");
  assert.equal(ret.pointsReturned, 100, "คืนแต้มที่แลกไปครึ่งหนึ่ง");
  // 950 − 415 + 100 = 635
  assert.equal((await getMember(tenantId, memberId))?.pointsUsable, 635);

  // ยิงคีย์เดิมซ้ำต้องได้ผลเดิมและไม่คิดแต้มใหม่
  const replay = await partiallyReturnPosSale({
    tenantId, deviceId, orderId: soldOrderId, actorUserId: cashierId,
    lines: [{ orderItemId: Number(items.rows[0].id), packQty: 5 }],
    idempotencyKey: key("ret-1"),
  });
  assert.equal(replay.status, "PARTIAL_RETURNED");
  if (replay.status === "PARTIAL_RETURNED") {
    assert.equal(replay.replayed, true);
    assert.equal(replay.creditNoteNo ?? null, ret.creditNoteNo ?? null,
      "retry ต้องได้เลขใบลดหนี้เดิม ไม่ข้ามงานเอกสารหลัง replay");
  }
  assert.equal((await getMember(tenantId, memberId))?.pointsUsable, 635);
});

test("recent sales carry the member so an exchange can re-attach them", async () => {
  const recent = await listRecentPosSales(tenantId, deviceId, 10);
  const mine = recent.find((r) => r.orderId === soldOrderId);
  assert.ok(mine, "บิลที่ขายไปต้องอยู่ในรายการบิลล่าสุด");
  assert.ok(mine!.memberNo, "ต้องมีเลขสมาชิกติดมาด้วย ไม่งั้น exchange ยกสมาชิกมาไม่ได้");
  assert.equal(mine!.returnEvents.length, 1, "ประวัติบิลต้องรวมการคืนบางส่วนครั้งนี้");
  assert.equal(mine!.returnEvents[0].returnMode, "PARTIAL");
  assert.equal(mine!.returnEvents[0].refundAmount, 415);
  assert.equal(mine!.returnEvents[0].items.length, 1);
  assert.equal(mine!.returnEvents[0].items[0].packQty, 5);
  assert.equal(mine!.returnEvents[0].refunds.length, 1);
  assert.equal(mine!.returnEvents[0].refunds[0].status, "COMPLETED", "คืนเงินสดต้องสำเร็จทันที");
  assert.ok(mine!.returnEvents[0].returnedByName, "Timeline ต้องบอกผู้ทำรายการ");
  const lines = await listOrderDiscounts(tenantId, soldOrderId);
  assert.equal(lines.length, 3);
});

test("partial return loses wholesale eligibility while the original receipt stays immutable", async () => {
  await query(
    `INSERT INTO bms_product_price_tiers
       (tenant_id, product_sku, min_qty, scope, discount_pct, unit_price, size)
     VALUES ($1,$2,5,'CROSS_VARIANT_PERCENT',10,NULL,NULL)`,
    [tenantId, SKU]
  );

  const sale = await recordPosSale({
    tenantId,
    deviceId,
    shiftId,
    cashierUserId: cashierId,
    idempotencyKey: key("wholesale-sale"),
    lines: [{ sku: SKU, size: SIZE, packQty: 5 }],
    payments: [{ method: "CASH", amount: 450, cashTendered: 500 }],
  });
  assert.equal(sale.status, "SOLD", JSON.stringify(sale));
  if (sale.status !== "SOLD") return;
  assert.deepEqual(
    sale.discountLines.map((line) => [line.source, line.amount]),
    [["PRICING", 50]],
    "ใบแรกต้องแยกราคาป้าย 500 − ส่วนลดราคาส่ง 50"
  );

  const stored = await query<{ id: string; unit_price: string; receipt_unit_price: string }>(
    `SELECT id, unit_price, receipt_unit_price
       FROM bms_order_items
      WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, sale.orderId]
  );
  assert.equal(Number(stored.rows[0].unit_price), 90, "ราคาที่ใช้คิดเงินจริงต้องเป็นราคาส่ง");
  assert.equal(Number(stored.rows[0].receipt_unit_price), 100, "ราคาป้ายบนใบเสร็จต้อง snapshot แยก");

  let recent = await listRecentPosSales(tenantId, deviceId, 20);
  let reprint = recent.find((row) => row.orderId === sale.orderId);
  assert.ok(reprint);
  assert.equal(reprint!.lines[0].packPrice, 100, "พิมพ์ซ้ำก่อนคืนต้องไม่เปลี่ยน 100 เป็น 90");
  assert.equal(reprint!.total, 450);
  assert.deepEqual(reprint!.discountLines.map((line) => [line.source, line.amount]), [["PRICING", 50]]);

  const returned = await partiallyReturnPosSale({
    tenantId,
    deviceId,
    orderId: sale.orderId,
    actorUserId: cashierId,
    lines: [{ orderItemId: Number(stored.rows[0].id), packQty: 1 }],
    note: `${TAG} wholesale partial`,
    idempotencyKey: key("wholesale-return"),
  });
  assert.equal(returned.status, "PARTIAL_RETURNED", JSON.stringify(returned));
  if (returned.status !== "PARTIAL_RETURNED") return;
  assert.equal(returned.refundAmount, 50,
    "คืนหนึ่งแล้วเหลือ 4 ต่ำกว่าขั้น 5: จ่ายเดิม 450 − มูลค่าคงเหลือ 400 = คืน 50");
  assert.equal(returned.returnedItems[0].refundAmount, 50);
  assert.equal(returned.pricingAdjustmentAmount, 40,
    "ราคาส่งเดิม 90 ถูกหักสิทธิ์คืน 40 เพราะของคงเหลือกลับไปเป็นราคาป้าย");
  assert.equal(returned.remainingAmount, 400);

  recent = await listRecentPosSales(tenantId, deviceId, 20);
  reprint = recent.find((row) => row.orderId === sale.orderId);
  assert.ok(reprint);
  assert.equal(reprint!.lines[0].packPrice, 100, "คืนแล้วใบขายเดิมยังต้องแสดงราคาป้ายเดิม");
  assert.equal(reprint!.lines[0].returnedPackQty, 1);
  assert.equal(reprint!.total, 450, "ใบขายเดิมเป็นเอกสารเดิม ยอดสุทธิตอนขายห้ามถูกเขียนทับ");
  assert.deepEqual(reprint!.discountLines.map((line) => [line.source, line.amount]), [["PRICING", 50]]);
});

test("close shift", async () => {
  const res = await closePosShift({
    tenantId, shiftId, closedBy: cashierId, countedCash: 1000 + 830 - 415 + 450 - 50,
  });
  // PENDING_REFUNDS ก็ถือว่าถูก: เงินคืนที่ไม่ใช่เงินสดต้องมีคนยืนยันก่อนปิดกะ
  assert.ok(["CLOSED", "PENDING_REFUNDS"].includes(res.status), JSON.stringify(res));
});

test("teardown: remove every row this suite created", async () => {
  const orders = await query<{ id: string }>(
    `SELECT id FROM bms_orders WHERE tenant_id = $1 AND pos_device_id = $2`, [tenantId, deviceId]
  );
  const orderIds = orders.rows.map((r) => r.id);
  if (orderIds.length) {
    await query(`DELETE FROM bms_pos_returns WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])`, [tenantId, orderIds]);
    await query(`DELETE FROM bms_tax_documents WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])`, [tenantId, orderIds]);
    await query(`DELETE FROM bms_loyalty_ledger WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])`, [tenantId, orderIds]);
    await query(`DELETE FROM bms_orders WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, orderIds]);
  }
  if (memberId) {
    await query(`DELETE FROM bms_loyalty_ledger WHERE tenant_id = $1 AND customer_id = $2`, [tenantId, memberId]);
    await query(`DELETE FROM bms_customers WHERE tenant_id = $1 AND id = $2`, [tenantId, memberId]);
  }
  await query(`DELETE FROM bms_pos_shifts WHERE tenant_id = $1 AND device_id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_pos_devices WHERE tenant_id = $1 AND id = $2`, [tenantId, deviceId]);
  // upsertMembershipTier/upsertCoupon แปลง code เป็นตัวพิมพ์ใหญ่ — ลบแบบไม่สนตัวพิมพ์
  // ไม่งั้นชั้นทดสอบค้างแล้วไปเปลี่ยนชั้นของสมาชิกจริงในรอบทบทวนถัดไป
  await query(`DELETE FROM bms_membership_tiers WHERE tenant_id = $1 AND upper(code) LIKE upper($2)`,
    [tenantId, `${TAG}-%`]);
  await query(`DELETE FROM bms_coupons WHERE tenant_id = $1 AND upper(code) LIKE upper($2)`,
    [tenantId, `${TAG}-%`]);
  await query(`DELETE FROM bms_stock_movements WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_inventory WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku = $2`, [tenantId, SKU]);

  const leftTiers = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM bms_membership_tiers WHERE tenant_id = $1 AND upper(code) LIKE upper($2)`,
    [tenantId, `${TAG}-%`]
  );
  assert.equal(Number(leftTiers.rows[0].n), 0, "ชั้นทดสอบต้องไม่ค้างในฐาน");
  const orphanTier = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM bms_customers c
      WHERE c.tenant_id = $1 AND c.tier_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM bms_membership_tiers t WHERE t.id = c.tier_id)`,
    [tenantId]
  );
  assert.equal(Number(orphanTier.rows[0].n), 0, "ต้องไม่มีลูกค้าที่ชี้ไปชั้นที่ถูกลบ");
});
