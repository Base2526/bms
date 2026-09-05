// =============================================================
// Gift cards / store credit (8.9)
// -------------------------------------------------------------
// Closes two gaps at once: gift cards could not be sold, and a return could only
// go back as cash or to the original method — never as store credit, which is
// what shops prefer because the money stays in the shop.
//
// Same ledger shape as loyalty points, with one deliberate difference that this
// suite pins: **credit cannot go negative.** Points are allowed to (it stops
// return-after-redeem being profitable), but credit is money, and a negative
// balance is the shop owing a customer with nobody having approved it.
//
// The other thing pinned here is that redemption happens inside the sale
// transaction and is idempotent — a register replaying a lost response must not
// spend the card twice.
//
// Run from apps/web:
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
//   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit \
//     ../../scripts/store-credit-db-contract.test.mts
//
// Writes to whatever database it is pointed at. Dev only.
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { DECLARE_FAKE_SALES_SURFACES_SQL } from "./testing/salesSurfaces.mts";
import {
  findStoreCredit,
  generateCreditCode,
  getStoreCreditOutstanding,
  issueStoreCredit,
} from "../apps/web/lib/bms/storeCredit.ts";
import {
  issuePosDeviceToken,
  openPosShift,
  recordPosSale,
  returnPosSale,
  setCashierPin,
  upsertPosDevice,
} from "../apps/web/lib/bms/pos.ts";

const TAG = "storecredit-test";
const SKU = `FAKE-${TAG}-SKU`;
const SIZE = "M";
const PIN = "6742";

let tenantId = "";
let locationId = "";
let deviceId = "";
let cashierId = "";
let shiftId = "";
let cardCode = "";

const key = (n: string) => `${TAG}-${n}-${process.pid}`;

test("setup: a ฿100 product, a register, and a ฿500 gift card", async () => {
  tenantId = (await query<{ id: string }>(`SELECT id FROM bms_tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  locationId = (await query<{ id: string }>(
    `SELECT id FROM bms_locations WHERE tenant_id = $1 AND active
      ORDER BY is_head_office DESC, created_at LIMIT 1`,
    [tenantId]
  )).rows[0].id;
  await query(
    `UPDATE bms_store_profile SET cash_rounding = 'NONE', pos_blind_close = FALSE WHERE tenant_id = $1`,
    [tenantId]
  );
  await query(`UPDATE bms_loyalty_settings SET enabled = FALSE WHERE tenant_id = $1`, [tenantId]);
  await query(
    `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category)
     VALUES ($1,$2,$3,100,TRUE,'V')
     ON CONFLICT (tenant_id, sku) DO UPDATE SET price = 100, active = TRUE`,
    [tenantId, SKU, `FAKE ${TAG} product`]
  );
  // สินค้าที่ INSERT ตรง ๆ เป็นฉบับร่างตั้งแต่ 9.51 — ต้องประกาศช่องทางขายเอง
  await query(DECLARE_FAKE_SALES_SURFACES_SQL, [tenantId]);
  await query(
    `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
     VALUES ($1,$2,$3,$4,200,0)
     ON CONFLICT (tenant_id, location_id, product_sku, size)
       DO UPDATE SET current_stock = 200, reserved_stock = 0`,
    [tenantId, locationId, SKU, SIZE]
  );

  const device = await upsertPosDevice(tenantId, {
    locationId, code: `${TAG}-REG`, name: `FAKE ${TAG} register`, active: true,
  });
  deviceId = device.id;
  await issuePosDeviceToken(tenantId, deviceId);
  cashierId = (await query<{ id: string }>(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.tenant_id = $1 AND r.name = 'Administrator' ORDER BY u.created_at LIMIT 1`,
    [tenantId]
  )).rows[0].id;
  await setCashierPin(tenantId, cashierId, PIN);
  const opened = await openPosShift({ tenantId, deviceId, openedBy: cashierId, openingFloat: 2000 });
  if (opened.status === "OPENED" || opened.status === "ALREADY_OPEN") shiftId = opened.shift.id;

  const issued = await issueStoreCredit({ tenantId, amount: 500, issuedBy: cashierId, note: TAG });
  assert.equal(issued.status, "ISSUED", JSON.stringify(issued));
  if (issued.status !== "ISSUED") return;
  cardCode = issued.credit.code;
  assert.equal(issued.credit.balance, 500);
});

test("generated codes are not guessable from one another", () => {
  // บัตรของขวัญคือเงินที่ใครถือก็ใช้ได้ · โค้ดที่เรียงกันแปลว่าคนที่ซื้อใบเดียว
  // เดาโค้ดใบอื่นได้ทั้งหมด
  const codes = new Set(Array.from({ length: 200 }, () => generateCreditCode()));
  assert.equal(codes.size, 200, "โค้ดต้องไม่ซ้ำกันเอง");
  for (const c of codes) {
    assert.match(c, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(/[IO01]/.test(c), false, "ตัดตัวที่สับสนทางสายตาออก (I/O/0/1)");
  }
});

test("paying with the card debits it inside the sale, and cash is untouched", async () => {
  const sale = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("s1"),
    lines: [{ sku: SKU, size: SIZE, packQty: 3 }],   // 300
    payments: [{ method: "STORE_CREDIT", amount: 300, ref: cardCode }],
  } as any);
  assert.equal(sale.status, "SOLD", JSON.stringify(sale));

  assert.equal((await findStoreCredit(tenantId, cardCode))!.balance, 200);

  // เครดิตไม่ใช่เงินสด — ยอดเงินในลิ้นชักต้องไม่ขยับ (ร้านรับเงินไปแล้วตอนขายบัตร)
  const cash = await query<{ total: string }>(
    `SELECT COALESCE(SUM(pay.amount),0) AS total FROM bms_payments pay
       JOIN bms_orders o ON o.id = pay.order_id AND o.tenant_id = pay.tenant_id
      WHERE o.tenant_id = $1 AND o.pos_shift_id = $2 AND pay.method = 'CASH'`,
    [tenantId, shiftId]
  );
  assert.equal(Number(cash.rows[0].total), 0);
});

test("replaying the same bill does not spend the card twice", async () => {
  const again = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("s1"),
    lines: [{ sku: SKU, size: SIZE, packQty: 3 }],
    payments: [{ method: "STORE_CREDIT", amount: 300, ref: cardCode }],
  } as any);
  assert.equal(again.status, "SOLD");
  assert.equal((await findStoreCredit(tenantId, cardCode))!.balance, 200,
    "ยิงซ้ำเพราะ response หายต้องไม่หักบัตรรอบสอง");
});

test("spending more than the card holds is refused before any stock moves", async () => {
  const before = await query<{ n: number }>(
    `SELECT current_stock AS n FROM bms_inventory
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, SKU, SIZE]
  );
  const res = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("over"),
    lines: [{ sku: SKU, size: SIZE, packQty: 5 }],   // 500 จากบัตรที่เหลือ 200
    payments: [{ method: "STORE_CREDIT", amount: 500, ref: cardCode }],
  } as any);
  assert.equal(res.status, "CREDIT_INSUFFICIENT");
  if (res.status === "CREDIT_INSUFFICIENT") {
    assert.equal(res.balance, 200);
    assert.equal(res.requested, 500);
  }
  const after = await query<{ n: number }>(
    `SELECT current_stock AS n FROM bms_inventory
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, SKU, SIZE]
  );
  assert.equal(Number(after.rows[0].n), Number(before.rows[0].n));
});

test("an unknown or missing code is refused with a readable reason", async () => {
  const unknown = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("unknown"),
    lines: [{ sku: SKU, size: SIZE, packQty: 1 }],
    payments: [{ method: "STORE_CREDIT", amount: 100, ref: "ZZZZ-ZZZZ-ZZZZ" }],
  } as any);
  assert.equal(unknown.status, "CREDIT_INVALID");

  const noCode = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("nocode"),
    lines: [{ sku: SKU, size: SIZE, packQty: 1 }],
    payments: [{ method: "STORE_CREDIT", amount: 100, ref: null }],
  } as any);
  assert.equal(noCode.status, "PAYMENT_FAILED");
});

test("an expired card cannot be spent", async () => {
  const expired = await issueStoreCredit({
    tenantId, amount: 100, issuedBy: cashierId, note: `${TAG}-expired`,
    expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
  });
  assert.equal(expired.status, "ISSUED");
  if (expired.status !== "ISSUED") return;

  const res = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("expired"),
    lines: [{ sku: SKU, size: SIZE, packQty: 1 }],
    payments: [{ method: "STORE_CREDIT", amount: 100, ref: expired.credit.code }],
  } as any);
  assert.equal(res.status, "CREDIT_INVALID");
});

test("returning the whole bill puts the credit back on the card", async () => {
  const sale = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("s2"),
    lines: [{ sku: SKU, size: SIZE, packQty: 2 }],   // 200 = ยอดที่เหลือทั้งหมด
    payments: [{ method: "STORE_CREDIT", amount: 200, ref: cardCode }],
  } as any);
  assert.equal(sale.status, "SOLD", JSON.stringify(sale));
  if (sale.status !== "SOLD") return;
  assert.equal((await findStoreCredit(tenantId, cardCode))!.balance, 0);

  const ret = await returnPosSale({
    tenantId, deviceId, shiftId, orderId: sale.orderId, actorUserId: cashierId,
    approvedByUserId: cashierId, note: "คืนทั้งบิลที่จ่ายด้วยบัตร",
    idempotencyKey: key("ret"),
  });
  assert.equal(ret.status, "RETURNED", JSON.stringify(ret));
  assert.equal((await findStoreCredit(tenantId, cardCode))!.balance, 200,
    "ไม่คืน = ลูกค้าเสียเงินบนบัตรไปเปล่า ๆ ทั้งที่ของกลับมาแล้ว");
});

test("the balance cache always agrees with the ledger", async () => {
  const outstanding = await getStoreCreditOutstanding(tenantId);
  assert.equal(outstanding.balanceMismatchCount, 0,
    "cache ไม่ตรงกับ ledger = มีทางเขียนที่ลืมลง ledger ซึ่งจะเพี้ยนต่อไปเงียบ ๆ");
  assert.ok(outstanding.outstandingAmount >= 200, "ยอดค้างเป็นหนี้สินที่ต้องส่งให้บัญชี");
});

test("the database refuses a negative balance even if code gets it wrong", async () => {
  const card = await findStoreCredit(tenantId, cardCode);
  await assert.rejects(
    () => query(
      `UPDATE bms_store_credits SET balance = -1 WHERE tenant_id = $1 AND id = $2`,
      [tenantId, card!.id]
    ),
    /balance/i,
    "แต้มยอมติดลบได้โดยตั้งใจ แต่เครดิตคือเงิน — ติดลบคือร้านเป็นหนี้โดยไม่มีใครอนุมัติ"
  );
});

test("teardown: remove every row this suite created", async () => {
  const orders = await query<{ id: string }>(
    `SELECT id FROM bms_orders WHERE tenant_id = $1 AND pos_device_id = $2`, [tenantId, deviceId]
  );
  const ids = orders.rows.map((r) => r.id);
  await query(`DELETE FROM bms_store_credit_ledger WHERE tenant_id = $1`, [tenantId]);
  await query(`DELETE FROM bms_store_credits WHERE tenant_id = $1`, [tenantId]);
  if (ids.length) {
    const rets = await query<{ id: string }>(
      `SELECT id FROM bms_pos_returns WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])`, [tenantId, ids]
    );
    if (rets.rowCount) {
      await query(`DELETE FROM bms_pos_refund_allocations WHERE tenant_id = $1 AND pos_return_id = ANY($2::uuid[])`,
        [tenantId, rets.rows.map((r) => r.id)]);
      await query(`DELETE FROM bms_pos_return_items WHERE tenant_id = $1 AND pos_return_id = ANY($2::uuid[])`,
        [tenantId, rets.rows.map((r) => r.id)]);
    }
    await query(`DELETE FROM bms_pos_returns WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])`, [tenantId, ids]);
    await query(`DELETE FROM bms_tax_documents WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])`, [tenantId, ids]);
    await query(`DELETE FROM bms_orders WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, ids]);
  }
  await query(`DELETE FROM bms_pos_shifts WHERE tenant_id = $1 AND device_id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_pos_devices WHERE tenant_id = $1 AND id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_stock_movements WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_inventory WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku = $2`, [tenantId, SKU]);
  await query(`UPDATE bms_loyalty_settings SET enabled = TRUE WHERE tenant_id = $1`, [tenantId]);
});
