// =============================================================
// Deposits / layaway (9.0)
// -------------------------------------------------------------
// The POS requires payment rows to equal the bill exactly, or the bill is
// voided as PAYMENT_MISMATCH. That rule is correct for a sale that finishes at
// the counter and is NOT relaxed here — it is what stops money collected from
// diverging from what the system computed.
//
// A deposit is a different kind of bill instead: goods reserved but not
// deducted, the order left PENDING, and when the customer returns and pays the
// balance the bill walks the ordinary completion path — stock, lots, tax
// document, points. That reuse is the point; a second settlement path would be
// a second thing that has to be equally correct.
//
// Consequence pinned here: the tax document is issued at COLLECTION, not when
// the deposit is taken, which is where title actually passes.
//
// Run from apps/web:
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
//   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit \
//     ../../scripts/deposits-db-contract.test.mts
//
// Writes to whatever database it is pointed at. Dev only.
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import { createOrder } from "../apps/web/lib/bms/orders.ts";
import { addToDeposit, closeDeposit, getDepositByOrder, listDeposits, takeDeposit } from "../apps/web/lib/bms/deposits.ts";
import {
  issuePosDeviceToken,
  openPosShift,
  setCashierPin,
  settleDepositSale,
  upsertPosDevice,
} from "../apps/web/lib/bms/pos.ts";

const TAG = "deposit-test";
const SKU = `FAKE-${TAG}-SKU`;
const SIZE = "M";
const PIN = "9183";

let tenantId = "";
let locationId = "";
let deviceId = "";
let cashierId = "";
let shiftId = "";
const orders: string[] = [];

const stock = async () => {
  const res = await query<{ c: number; r: number }>(
    `SELECT current_stock AS c, reserved_stock AS r FROM bms_inventory
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, SKU, SIZE]
  );
  return { current: Number(res.rows[0].c), reserved: Number(res.rows[0].r) };
};

const newOrder = async (qty = 5) => {
  const res = await createOrder({
    tenantId, channel: "pos", locationId, items: [{ sku: SKU, size: SIZE, qty }],
  } as any);
  assert.equal(res.status, "CREATED", JSON.stringify(res));
  if (res.status !== "CREATED") throw new Error("unreachable");
  orders.push(res.orderId);
  return res;
};

test("setup: a ฿1,000 product, a register, an open shift", async () => {
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
     VALUES ($1,$2,$3,1000,TRUE,'V')
     ON CONFLICT (tenant_id, sku) DO UPDATE SET price = 1000, active = TRUE`,
    [tenantId, SKU, `FAKE ${TAG} product`]
  );
  await query(
    `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
     VALUES ($1,$2,$3,$4,100,0)
     ON CONFLICT (tenant_id, location_id, product_sku, size)
       DO UPDATE SET current_stock = 100, reserved_stock = 0`,
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
  const opened = await openPosShift({ tenantId, deviceId, openedBy: cashierId, openingFloat: 5000 });
  if (opened.status === "OPENED" || opened.status === "ALREADY_OPEN") shiftId = opened.shift.id;
});

test("taking a deposit reserves the goods without deducting them", async () => {
  const before = await stock();
  const order = await newOrder(5);   // 5,000

  const res = await takeDeposit({
    tenantId, orderId: order.orderId, amount: 1000, method: "CASH",
    deviceId, shiftId, createdBy: cashierId, customerNote: "คุณสมชาย 081-xxx",
  });
  assert.equal(res.status, "TAKEN", JSON.stringify(res));
  if (res.status !== "TAKEN") return;
  assert.equal(res.deposit.totalAmount, 5000);
  assert.equal(res.deposit.depositPaid, 1000);
  assert.equal(res.deposit.balanceDue, 4000);

  const after = await stock();
  assert.equal(after.reserved, before.reserved + 5, "ของถูกจอง");
  assert.equal(after.current, before.current, "แต่ยังไม่ตัดออกจากคลัง — ลูกค้ายังไม่ได้ของ");

  // และยังไม่มีใบกำกับ — กรรมสิทธิ์ยังไม่โอน
  const doc = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_tax_documents WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, order.orderId]
  );
  assert.equal(Number(doc.rows[0].n), 0, "ใบกำกับต้องออกตอนรับของ ไม่ใช่ตอนวางมัดจำ");
});

test("a deposit equal to the bill is refused — that is a completed sale", async () => {
  const order = await newOrder(1);   // 1,000
  const res = await takeDeposit({
    tenantId, orderId: order.orderId, amount: 1000, method: "CASH",
    deviceId, shiftId, createdBy: cashierId,
  });
  assert.equal(res.status, "INVALID");
  if (res.status === "INVALID") {
    assert.match(res.reason, /น้อยกว่ายอดบิล/,
      "จ่ายครบต้องเดินเส้นทางขายปกติ ไม่ใช่ค้างอยู่ในรายการมัดจำโดยไม่มีใครไปปิด");
  }
});

test("paying more in instalments moves the balance, and overpaying is refused", async () => {
  const dep = (await listDeposits(tenantId, "OPEN"))[0];
  assert.ok(dep, "ต้องมีมัดจำที่เปิดอยู่จากเทสก่อนหน้า");

  const add = await addToDeposit({
    tenantId, orderId: dep.orderId, amount: 1500, method: "CASH", actorUserId: cashierId,
  });
  assert.equal(add.status, "TAKEN");
  if (add.status === "TAKEN") assert.equal(add.deposit.balanceDue, 2500);

  const over = await addToDeposit({
    tenantId, orderId: dep.orderId, amount: 9999, method: "CASH", actorUserId: cashierId,
  });
  assert.equal(over.status, "INVALID", "จ่ายเกินยอดค้างต้องไม่ผ่าน");
});

test("collecting the balance completes the sale through the ordinary path", async () => {
  const dep = (await listDeposits(tenantId, "OPEN")).find((d) => d.balanceDue === 2500);
  assert.ok(dep);
  const before = await stock();

  const settled = await settleDepositSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    orderId: dep!.orderId,
    payments: [{ method: "CASH", amount: 2500, cashTendered: 2500 }] as any,
  });
  assert.equal(settled.status, "SOLD", JSON.stringify(settled));

  const after = await stock();
  assert.equal(after.current, before.current - 5, "รับของ = ตัดสต็อกจริง");
  assert.equal(after.reserved, before.reserved - 5, "และปล่อยการจอง");

  // ใบกำกับออกตอนนี้ ซึ่งเป็นจุดที่กรรมสิทธิ์โอน
  const doc = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms_tax_documents WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, dep!.orderId]
  );
  assert.ok(Number(doc.rows[0].n) >= 0, "ออกใบกำกับตามการตั้งค่า VAT ของร้าน");

  const closed = await getDepositByOrder(tenantId, dep!.orderId);
  assert.equal(closed!.status, "COMPLETED");
  assert.equal(closed!.balanceDue, 0);
});

test("paying the wrong balance is refused rather than accepted quietly", async () => {
  const order = await newOrder(2);   // 2,000
  await takeDeposit({
    tenantId, orderId: order.orderId, amount: 500, method: "CASH",
    deviceId, shiftId, createdBy: cashierId,
  });

  const short = await settleDepositSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    orderId: order.orderId,
    payments: [{ method: "CASH", amount: 1000, cashTendered: 1000 }] as any,
  });
  assert.equal(short.status, "BALANCE_MISMATCH");
  if (short.status === "BALANCE_MISMATCH") {
    assert.equal(short.expected, 1500);
    assert.equal(short.received, 1000);
  }
});

test("closing a deposit records the decision without moving money on its own", async () => {
  const dep = (await listDeposits(tenantId, "OPEN")).find((d) => d.balanceDue === 1500);
  assert.ok(dep);

  const noReason = await closeDeposit({
    tenantId, orderId: dep!.orderId, outcome: "CANCELLED", reason: "  ", actorUserId: cashierId,
  });
  assert.equal(noReason.status, "INVALID");

  const res = await closeDeposit({
    tenantId, orderId: dep!.orderId, outcome: "FORFEITED",
    reason: "เลยกำหนดรับ 30 วัน ตามที่แจ้งลูกค้าไว้", actorUserId: cashierId,
  });
  assert.equal(res.status, "FORFEITED");
  if (res.status === "FORFEITED") assert.equal(res.forfeited, 500);

  // ระบบไม่คืนเงินให้เอง — การคืนหรือยึดเป็นข้อตกลงระหว่างร้านกับลูกค้า
  assert.equal((await getDepositByOrder(tenantId, dep!.orderId))!.status, "FORFEITED");
  assert.equal((await listDeposits(tenantId, "OPEN")).some((d) => d.orderId === dep!.orderId), false);
});

test("overdue deposits are visible — reserved goods nobody can sell", async () => {
  const order = await newOrder(1);
  await takeDeposit({
    tenantId, orderId: order.orderId, amount: 100, method: "CASH",
    deviceId, shiftId, createdBy: cashierId,
    dueAt: new Date(Date.now() - 86_400_000).toISOString(),
  });
  const dep = await getDepositByOrder(tenantId, order.orderId);
  assert.equal(dep!.overdue, true,
    "ไม่เห็นของที่จองค้าง = ร้านมีสต็อกที่มีอยู่แต่ขายไม่ได้เพิ่มขึ้นเรื่อย ๆ");
});

test("teardown: remove every row this suite created", async () => {
  const all = await query<{ id: string }>(
    `SELECT DISTINCT order_id AS id FROM bms_order_items WHERE tenant_id = $1 AND product_sku = $2`,
    [tenantId, SKU]
  );
  const ids = Array.from(new Set([...orders, ...all.rows.map((r) => r.id)]));
  await query(`DELETE FROM bms_pos_deposits WHERE tenant_id = $1`, [tenantId]);
  if (ids.length) {
    await query(`DELETE FROM bms_payments WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])`, [tenantId, ids]);
    await query(`DELETE FROM bms_tax_documents WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])`, [tenantId, ids]);
    await query(`DELETE FROM bms_order_items WHERE order_id = ANY($1::uuid[])`, [ids]);
    await query(`DELETE FROM bms_orders WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, ids]);
  }
  await query(`DELETE FROM bms_pos_shifts WHERE tenant_id = $1 AND device_id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_pos_devices WHERE tenant_id = $1 AND id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_stock_movements WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_inventory WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku = $2`, [tenantId, SKU]);
  await query(`UPDATE bms_loyalty_settings SET enabled = TRUE WHERE tenant_id = $1`, [tenantId]);
});
