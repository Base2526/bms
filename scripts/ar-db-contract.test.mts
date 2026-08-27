// =============================================================
// ขายเชื่อ / ลูกหนี้การค้า (9.30) — เทสกับ Postgres จริง
// -------------------------------------------------------------
// สิ่งที่ชุดนี้ต้องพิสูจน์ เรียงตามความเสียหายถ้าผิด:
//
//   1. ยอดเชื่อ **ไม่เข้าลิ้นชัก** — ถ้าเข้า ทุกร้านที่ขายเชื่อจะนับปิดกะเกินจริง
//      เท่ายอดเชื่อทุกวัน แล้วหาสาเหตุไม่เจอเพราะบิลก็ถูก เงินก็ถูก
//   2. เกินวงเงิน = ล้ม **ก่อน** ตัดสต็อก ไม่ใช่หลังจากของถูกจองไปแล้ว
//   3. คืนของบิลเชื่อ = **ลดหนี้** ไม่ใช่จ่ายเงินคืน (เงินยังไม่เคยเข้ามาให้คืน)
//   4. เงินที่รับคืนมาทีหลังเข้าลิ้นชักของ **กะที่รับ** ไม่ใช่กะที่ขาย
//   5. ยอดในตารางบัญชีต้องเท่ากับผลรวมสมุดรายวันเสมอ (balanceMismatchCount = 0)
//
// รันจาก apps/web:
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
//   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit \
//     ../../scripts/ar-db-contract.test.mts
//
// เขียนจริงลงฐานที่ชี้ไป — ห้ามรันกับ production
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import {
  getArAccountByCustomer,
  getArInvoiceByOrder,
  getArOutstanding,
  getArShiftSummary,
  listArInvoices,
  listArLedger,
  recordArReceipt,
  upsertArAccount,
  writeOffArInvoice,
} from "../apps/web/lib/bms/ar.ts";
import {
  getPosShiftReport,
  issuePosDeviceToken,
  openPosShift,
  partiallyReturnPosSale,
  recordPosSale,
  setCashierPin,
  upsertPosDevice,
  voidPosSale,
} from "../apps/web/lib/bms/pos.ts";

const TAG = "ar-test";
const SKU = `FAKE-${TAG}-SKU`;
const SIZE = "M";
const PIN = "7412";
const key = (name: string) => `${TAG}-${name}-${process.pid}`;

let tenantId = "";
let locationId = "";
let deviceId = "";
let cashierId = "";
let shiftId = "";
let customerId = "";
/** ลูกค้าคนที่สอง — ใช้กับเคสที่ต้องแยกบัญชีออกจากกันจริง ๆ */
let otherCustomerId = "";
/** ลูกค้าที่แยกไว้พิสูจน์ยอดเครดิตติดลบหักกลบบิลถัดไป */
let creditOffsetCustomerId = "";
const orders: string[] = [];

const stock = async () => {
  const res = await query<{ c: number; r: number }>(
    `SELECT current_stock AS c, reserved_stock AS r FROM bms_inventory
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, SKU, SIZE]
  );
  return { current: Number(res.rows[0].c), reserved: Number(res.rows[0].r) };
};

const expectedCash = async () => {
  const report = await getPosShiftReport(tenantId, shiftId, deviceId);
  assert.ok(report, "อ่านสรุปกะไม่ได้");
  assert.equal(report!.expectedCashHidden, false, "โหมดนับปิดตาเปิดอยู่ — setup ต้องปิดก่อน");
  return Number(report!.expectedCash);
};

/** ขายหนึ่งบิลด้วยชุดการชำระที่ระบุ */
const sell = async (
  name: string,
  payments: Array<{ method: string; amount: number; cashTendered?: number }>,
  opts: { packQty?: number; customerId?: string | null } = {}
) => {
  const res = await recordPosSale({
    tenantId,
    deviceId,
    shiftId,
    cashierUserId: cashierId,
    idempotencyKey: key(name),
    lines: [{ sku: SKU, size: SIZE, packQty: opts.packQty ?? 2 }],
    payments: payments as any,
    customerId: opts.customerId === undefined ? customerId : opts.customerId,
    creditApprovedBy: cashierId,
  });
  if (res.status === "SOLD") orders.push(res.orderId);
  return res;
};

test("setup: สินค้า ฿1,000 · เครื่องขาย · กะที่เปิดอยู่ · ลูกค้าที่มีวงเงิน ฿5,000", async () => {
  tenantId = (await query<{ id: string }>(`SELECT id FROM bms_tenants ORDER BY created_at LIMIT 1`)).rows[0].id;
  locationId = (await query<{ id: string }>(
    `SELECT id FROM bms_locations WHERE tenant_id = $1 AND active
      ORDER BY is_head_office DESC, created_at LIMIT 1`,
    [tenantId]
  )).rows[0].id;
  // นับปิดตาต้องปิด ไม่งั้นอ่าน expectedCash ระหว่างกะเปิดไม่ได้ (8.0)
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
     VALUES ($1,$2,$3,$4,500,0)
     ON CONFLICT (tenant_id, location_id, product_sku, size)
       DO UPDATE SET current_stock = 500, reserved_stock = 0`,
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

  customerId = (await query<{ id: string }>(
    `INSERT INTO bms_customers (tenant_id, name, phone, tags)
     VALUES ($1,$2,$3,ARRAY['fake',$4]) RETURNING id`,
    [tenantId, `FAKE ${TAG} ร้านข้าวแกงป้าหวาน`, `08${String(process.pid).padStart(8, "0")}`.slice(0, 10), TAG]
  )).rows[0].id;
  otherCustomerId = (await query<{ id: string }>(
    `INSERT INTO bms_customers (tenant_id, name, tags)
     VALUES ($1,$2,ARRAY['fake',$3]) RETURNING id`,
    [tenantId, `FAKE ${TAG} ลูกค้าเงินสด`, TAG]
  )).rows[0].id;
  creditOffsetCustomerId = (await query<{ id: string }>(
    `INSERT INTO bms_customers (tenant_id, name, tags)
     VALUES ($1,$2,ARRAY['fake',$3]) RETURNING id`,
    [tenantId, `FAKE ${TAG} ลูกค้ายอดเครดิตคงเหลือ`, TAG]
  )).rows[0].id;

  const account = await upsertArAccount({
    tenantId, customerId, creditLimit: 5000, termsDays: 30, actorUserId: cashierId,
  });
  assert.equal(account.status, "SAVED", JSON.stringify(account));
  const offsetAccount = await upsertArAccount({
    tenantId, customerId: creditOffsetCustomerId, creditLimit: 5000,
    termsDays: 30, actorUserId: cashierId,
  });
  assert.equal(offsetAccount.status, "SAVED", JSON.stringify(offsetAccount));
});

// ---------------------------------------------------------------
// 1. ขายเชื่อ
// ---------------------------------------------------------------

test("ขายเชื่อ: ของออกจากร้านจริง บิลปิด และเกิดหนี้เท่ายอดที่ค้าง", async () => {
  const before = await stock();
  const res = await sell("credit-1", [{ method: "CREDIT", amount: 2000 }]);
  assert.equal(res.status, "SOLD", JSON.stringify(res));
  if (res.status !== "SOLD") return;

  const after = await stock();
  assert.equal(after.current, before.current - 2, "ขายเชื่อคือของออกจากร้านแล้ว ต้องตัดสต็อกจริง");
  assert.equal(after.reserved, before.reserved, "ของถูกตัดจริง ไม่ใช่ค้างเป็นของจอง (นั่นคือมัดจำ)");

  const order = await query<{ status: string }>(
    `SELECT status FROM bms_orders WHERE tenant_id = $1 AND id = $2`, [tenantId, res.orderId]
  );
  assert.equal(order.rows[0].status, "COMPLETED", "บิลขายเชื่อต้องปิดครบเส้นเหมือนบิลเงินสด");

  const invoice = await getArInvoiceByOrder(tenantId, res.orderId);
  assert.ok(invoice, "ขายเชื่อแล้วไม่มีใบแจ้งหนี้ = ของออกจากร้านโดยไม่มีใครเป็นหนี้");
  assert.equal(invoice!.amount, 2000);
  assert.equal(invoice!.outstanding, 2000);
  assert.equal(invoice!.status, "OPEN");

  const account = await getArAccountByCustomer(tenantId, customerId);
  assert.equal(account!.balance, 2000);
  assert.equal(account!.availableCredit, 3000);
});

test("⚠️ ยอดเชื่อต้องไม่เข้าสูตรเงินที่ควรมีในลิ้นชัก", async () => {
  // ผิดข้อนี้ = ทุกร้านที่ขายเชื่อนับปิดกะเกินจริงทุกวัน โดยที่บิลถูกและเงินก็ถูก
  const before = await expectedCash();
  const res = await sell("credit-drawer", [{ method: "CREDIT", amount: 1000 }], { packQty: 1 });
  assert.equal(res.status, "SOLD", JSON.stringify(res));
  assert.equal(await expectedCash(), before, "ยอดขายเชื่อไปโผล่ในเงินที่ควรมีในลิ้นชัก");
});

test("เกินวงเงิน: ถูกปฏิเสธโดยที่สต็อกไม่ถูกแตะเลย", async () => {
  const before = await stock();
  // ค้างอยู่ 3,000 (2,000 + 1,000) วงเงิน 5,000 → ขอ 4,000 ต้องไม่ผ่าน
  const res = await sell("credit-over", [{ method: "CREDIT", amount: 4000 }], { packQty: 4 });
  assert.equal(res.status, "AR_NOT_ALLOWED", JSON.stringify(res));
  assert.equal((res as any).code, "LIMIT_EXCEEDED");
  assert.deepEqual(await stock(), before, "บิลที่ถูกปฏิเสธเพราะวงเงินต้องไม่ทิ้งสต็อกที่จองไว้");
});

test("ขายเชื่อโดยไม่ระบุลูกค้าไม่ได้ — หนี้ที่ไม่รู้ว่าใครเป็นหนี้ไม่ใช่ลูกหนี้", async () => {
  const res = await sell("credit-nocust", [{ method: "CREDIT", amount: 1000 }], {
    packQty: 1, customerId: null,
  });
  assert.equal(res.status, "AR_NOT_ALLOWED", JSON.stringify(res));
  assert.equal((res as any).code, "NO_CUSTOMER");
});

test("ลูกค้าที่ไม่มีบัญชีเครดิตขายเชื่อไม่ได้", async () => {
  const res = await sell("credit-noacct", [{ method: "CREDIT", amount: 1000 }], {
    packQty: 1, customerId: otherCustomerId,
  });
  assert.equal(res.status, "AR_NOT_ALLOWED", JSON.stringify(res));
  assert.equal((res as any).code, "NO_ACCOUNT");
});

test("จ่ายสดบางส่วน ค้างบางส่วน: เฉพาะส่วนที่ค้างกลายเป็นหนี้ ส่วนเงินสดเข้าลิ้นชัก", async () => {
  const cashBefore = await expectedCash();
  const res = await sell("credit-split", [
    { method: "CASH", amount: 600, cashTendered: 600 },
    { method: "CREDIT", amount: 400 },
  ], { packQty: 1 });
  assert.equal(res.status, "SOLD", JSON.stringify(res));
  if (res.status !== "SOLD") return;

  const invoice = await getArInvoiceByOrder(tenantId, res.orderId);
  assert.equal(invoice!.amount, 400, "หนี้ต้องเท่าส่วนที่ค้าง ไม่ใช่ยอดบิลทั้งใบ");
  assert.equal(await expectedCash(), cashBefore + 600, "ส่วนที่จ่ายสดต้องเข้าลิ้นชักตามปกติ");
});

test("บัญชีที่ถูกระงับขายเชื่อไม่ได้ แต่ยังรับชำระได้", async () => {
  await upsertArAccount({
    tenantId, customerId, creditLimit: 5000, termsDays: 30, status: "ON_HOLD", actorUserId: cashierId,
  });
  const res = await sell("credit-hold", [{ method: "CREDIT", amount: 100 }], { packQty: 1 });
  assert.equal(res.status, "AR_NOT_ALLOWED", JSON.stringify(res));
  assert.equal((res as any).code, "ON_HOLD");

  const account = await getArAccountByCustomer(tenantId, customerId);
  const collect = await recordArReceipt({
    tenantId, accountId: account!.id, amount: 1, method: "BANK_TRANSFER",
    receivedBy: cashierId, idempotencyKey: key("collect-onhold"),
  });
  assert.equal(collect.status, "RECEIVED", "การระงับต้องห้ามขายเพิ่ม ไม่ใช่ห้ามใช้หนี้");

  await upsertArAccount({
    tenantId, customerId, creditLimit: 5000, termsDays: 30, status: "ACTIVE", actorUserId: cashierId,
  });
});

// ---------------------------------------------------------------
// 2. รับชำระหนี้
// ---------------------------------------------------------------

test("รับชำระเป็นเงินสด: เข้าลิ้นชักของกะที่รับ และตัดใบที่ครบกำหนดก่อน", async () => {
  const account = await getArAccountByCustomer(tenantId, customerId);
  const openBefore = await listArInvoices(tenantId, { accountId: account!.id, openOnly: true });
  assert.ok(openBefore.length >= 2, "เทสนี้ต้องมีใบค้างอย่างน้อยสองใบเพื่อดูลำดับการตัด");
  const oldest = openBefore[0];
  const cashBefore = await expectedCash();

  const res = await recordArReceipt({
    tenantId, accountId: account!.id, amount: oldest.outstanding, method: "CASH",
    receivedBy: cashierId, idempotencyKey: key("collect-cash"),
    locationId, deviceId, shiftId,
  });
  assert.equal(res.status, "RECEIVED", JSON.stringify(res));
  if (res.status !== "RECEIVED") return;

  assert.equal(res.allocations.length, 1, "ยอดเท่าใบเดียวพอดีต้องตัดใบเดียว");
  assert.equal(res.allocations[0].invoiceId, oldest.id, "ต้องตัดใบที่ครบกำหนดก่อนเสมอ");

  const settled = (await listArInvoices(tenantId, { accountId: account!.id }))
    .find((row) => row.id === oldest.id);
  assert.equal(settled!.status, "PAID");
  assert.equal(settled!.outstanding, 0);

  assert.equal(
    await expectedCash(),
    Math.round((cashBefore + oldest.outstanding) * 100) / 100,
    "เงินสดที่รับคืนมาต้องเข้าลิ้นชักของกะที่รับ ไม่ใช่หายไปเฉย ๆ"
  );
  const movement = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM bms_pos_cash_movements
      WHERE tenant_id = $1 AND shift_id = $2 AND direction = 'IN'
        AND idempotency_key = $3`,
    [tenantId, shiftId, `ar-receipt:${key("collect-cash")}`]
  );
  assert.equal(Number(movement.rows[0].n), 1, "ต้องมีรายการเงินเข้าลิ้นชักหนึ่งรายการต่อการรับหนึ่งครั้ง");
});

test("กดรับชำระซ้ำด้วยคีย์เดิมต้องไม่รับเงินสองรอบ", async () => {
  const account = await getArAccountByCustomer(tenantId, customerId);
  const balanceBefore = account!.balance;
  const cashBefore = await expectedCash();
  const original = await query<{ amount: string }>(
    `SELECT amount FROM bms_ar_receipts WHERE tenant_id = $1 AND idempotency_key = $2`,
    [tenantId, key("collect-cash")]
  );
  assert.ok(original.rows[0], "หาใบรับเงินต้นทางสำหรับทดสอบ replay ไม่เจอ");

  const replay = await recordArReceipt({
    tenantId, accountId: account!.id, amount: Number(original.rows[0].amount), method: "CASH",
    receivedBy: cashierId, idempotencyKey: key("collect-cash"),
    locationId, deviceId, shiftId,
  });
  assert.equal(replay.status, "RECEIVED");
  if (replay.status === "RECEIVED") assert.equal(replay.replayed, true);

  assert.equal((await getArAccountByCustomer(tenantId, customerId))!.balance, balanceBefore);
  assert.equal(await expectedCash(), cashBefore, "การกดซ้ำทำให้เงินเข้าลิ้นชักสองรอบ");
});

test("คีย์รับชำระเดิมกับ payload คนละก้อนต้อง conflict ไม่ใช่ replay ใบเก่า", async () => {
  const account = await getArAccountByCustomer(tenantId, customerId);
  const balanceBefore = account!.balance;
  const cashBefore = await expectedCash();
  const original = await query<{ amount: string }>(
    `SELECT amount FROM bms_ar_receipts WHERE tenant_id = $1 AND idempotency_key = $2`,
    [tenantId, key("collect-cash")]
  );

  const conflict = await recordArReceipt({
    tenantId, accountId: account!.id, amount: Number(original.rows[0].amount) + 0.01, method: "CASH",
    receivedBy: cashierId, idempotencyKey: key("collect-cash"),
    locationId, deviceId, shiftId,
  });
  assert.equal(conflict.status, "IDEMPOTENCY_CONFLICT", JSON.stringify(conflict));
  assert.equal((await getArAccountByCustomer(tenantId, customerId))!.balance, balanceBefore);
  assert.equal(await expectedCash(), cashBefore, "payload ที่ conflict ทำให้เงินเข้าลิ้นชัก");
});

test("รับเกินยอดค้างไม่ได้ — และต้องไม่รับเงินไว้บางส่วนแล้วบอกว่าล้ม", async () => {
  const account = await getArAccountByCustomer(tenantId, customerId);
  const before = account!.balance;
  const res = await recordArReceipt({
    tenantId, accountId: account!.id, amount: before + 1000, method: "BANK_TRANSFER",
    receivedBy: cashierId, idempotencyKey: key("collect-over"),
  });
  assert.equal(res.status, "OVER_PAYMENT", JSON.stringify(res));
  assert.equal((await getArAccountByCustomer(tenantId, customerId))!.balance, before);
  const receipts = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM bms_ar_receipts WHERE tenant_id = $1 AND idempotency_key = $2`,
    [tenantId, key("collect-over")]
  );
  assert.equal(Number(receipts.rows[0].n), 0, "คำขอที่ถูกปฏิเสธต้องไม่ทิ้งใบรับเงินค้างไว้");
});

test("เงินสดต้องมีกะรองรับ — รับเงินสดโดยไม่ผูกลิ้นชักไม่ได้", async () => {
  const account = await getArAccountByCustomer(tenantId, customerId);
  const res = await recordArReceipt({
    tenantId, accountId: account!.id, amount: 1, method: "CASH",
    receivedBy: cashierId, idempotencyKey: key("collect-nodrawer"),
  });
  assert.equal(res.status, "INVALID", JSON.stringify(res));
});

test("เงินก้อนเดียวตัดได้หลายใบ และตัดบางส่วนของใบสุดท้าย", async () => {
  const account = await getArAccountByCustomer(tenantId, customerId);
  const open = await listArInvoices(tenantId, { accountId: account!.id, openOnly: true });
  assert.ok(open.length >= 2, "เทสนี้ต้องมีใบค้างอย่างน้อยสองใบ");
  const amount = Math.round((open[0].outstanding + open[1].outstanding / 2) * 100) / 100;

  const res = await recordArReceipt({
    tenantId, accountId: account!.id, amount, method: "BANK_TRANSFER", reference: "SCB-0001",
    receivedBy: cashierId, idempotencyKey: key("collect-multi"),
  });
  assert.equal(res.status, "RECEIVED", JSON.stringify(res));
  if (res.status !== "RECEIVED") return;
  assert.equal(res.allocations.length, 2);

  const after = await listArInvoices(tenantId, { accountId: account!.id });
  assert.equal(after.find((row) => row.id === open[0].id)!.status, "PAID");
  const partial = after.find((row) => row.id === open[1].id)!;
  assert.equal(partial.status, "PARTIAL", "ใบที่ถูกตัดบางส่วนต้องยังค้างอยู่ ไม่ใช่ปิดทั้งใบ");
});

// ---------------------------------------------------------------
// 3. คืนของ / ยกเลิกบิล
// ---------------------------------------------------------------

test("คืนของบิลเชื่อ = ลดหนี้ ไม่ใช่จ่ายเงินคืน (เงินยังไม่เคยเข้ามา)", async () => {
  const sold = await sell("credit-return", [{ method: "CREDIT", amount: 2000 }], { packQty: 2 });
  assert.equal(sold.status, "SOLD", JSON.stringify(sold));
  if (sold.status !== "SOLD") return;

  const balanceBefore = (await getArAccountByCustomer(tenantId, customerId))!.balance;
  const cashBefore = await expectedCash();
  const items = await query<{ id: string }>(
    `SELECT id FROM bms_order_items WHERE tenant_id = $1 AND order_id = $2 ORDER BY id LIMIT 1`,
    [tenantId, sold.orderId]
  );

  const ret = await partiallyReturnPosSale({
    tenantId, deviceId, orderId: sold.orderId, actorUserId: cashierId,
    lines: [{ orderItemId: Number(items.rows[0].id), packQty: 1 }],
    note: "REASON:CUSTOMER_CHANGE ลูกค้าคืนของ",
    idempotencyKey: key("return-credit"),
  });
  assert.equal(ret.status, "PARTIAL_RETURNED", JSON.stringify(ret));
  if (ret.status !== "PARTIAL_RETURNED") return;

  assert.equal(
    ret.settlementStatus, "COMPLETED",
    "การลดหนี้ไม่มีขาที่ต้องไปทำกับธนาคาร — ค้าง PENDING จะทำให้ปิดกะไม่ได้"
  );
  assert.ok(ret.refunds.some((r) => r.method === "CREDIT"), "รายการคืนต้องอ้างวิธีชำระเดิม");

  const balanceAfter = (await getArAccountByCustomer(tenantId, customerId))!.balance;
  assert.equal(
    balanceAfter, Math.round((balanceBefore - ret.refundAmount) * 100) / 100,
    "คืนของแล้วหนี้ไม่ลด = ลูกค้าคืนของแต่ยังต้องจ่ายเต็ม"
  );
  assert.equal(await expectedCash(), cashBefore, "การคืนบิลเชื่อต้องไม่จ่ายเงินสดออกจากลิ้นชัก");

  const invoice = await getArInvoiceByOrder(tenantId, sold.orderId);
  assert.equal(invoice!.creditedAmount, ret.refundAmount);
  assert.equal(invoice!.status, "PARTIAL");
});

test("คืนซ้ำด้วยคีย์เดิมต้องไม่ลดหนี้สองรอบ", async () => {
  const balanceBefore = (await getArAccountByCustomer(tenantId, customerId))!.balance;
  const sold = orders[orders.length - 1];
  const items = await query<{ id: string }>(
    `SELECT id FROM bms_order_items WHERE tenant_id = $1 AND order_id = $2 ORDER BY id LIMIT 1`,
    [tenantId, sold]
  );
  await partiallyReturnPosSale({
    tenantId, deviceId, orderId: sold, actorUserId: cashierId,
    lines: [{ orderItemId: Number(items.rows[0].id), packQty: 1 }],
    note: "REASON:CUSTOMER_CHANGE ลูกค้าคืนของ",
    idempotencyKey: key("return-credit"),
  });
  assert.equal((await getArAccountByCustomer(tenantId, customerId))!.balance, balanceBefore);
});

test("ยกเลิกบิลเชื่อ: หนี้หายทั้งก้อนและใบถูกปิดเป็น VOID", async () => {
  const sold = await sell("credit-void", [{ method: "CREDIT", amount: 1000 }], { packQty: 1 });
  assert.equal(sold.status, "SOLD", JSON.stringify(sold));
  if (sold.status !== "SOLD") return;

  const balanceBefore = (await getArAccountByCustomer(tenantId, customerId))!.balance;
  const voided = await voidPosSale({
    tenantId, deviceId, shiftId, orderId: sold.orderId, actorUserId: cashierId,
    reason: "กดผิดบิล", idempotencyKey: key("void-credit"),
  } as any);
  assert.ok(
    String((voided as any).status).includes("VOID") || (voided as any).status === "PARTIAL_RETURNED",
    JSON.stringify(voided)
  );

  const invoice = await getArInvoiceByOrder(tenantId, sold.orderId);
  assert.equal(invoice!.outstanding, 0);
  assert.equal(invoice!.status, "VOID", "บิลที่ยกเลิกแล้วต้องไม่เหลือหนี้ค้างในรายงานอายุหนี้");
  assert.equal(
    (await getArAccountByCustomer(tenantId, customerId))!.balance,
    Math.round((balanceBefore - 1000) * 100) / 100
  );
});

test("ยอดเครดิตจากคืนของหลังจ่ายครบหักกลบบิลเชื่อถัดไป โดย aging ไม่สร้างหนี้ปลอม", async () => {
  const first = await sell(
    "credit-offset-source",
    [{ method: "CREDIT", amount: 2000 }],
    { packQty: 2, customerId: creditOffsetCustomerId }
  );
  assert.equal(first.status, "SOLD", JSON.stringify(first));
  if (first.status !== "SOLD") return;

  const account = await getArAccountByCustomer(tenantId, creditOffsetCustomerId);
  const paid = await recordArReceipt({
    tenantId, accountId: account!.id, amount: 2000, method: "BANK_TRANSFER",
    receivedBy: cashierId, idempotencyKey: key("collect-offset-source"),
  });
  assert.equal(paid.status, "RECEIVED", JSON.stringify(paid));

  const voided = await voidPosSale({
    tenantId, deviceId, shiftId, orderId: first.orderId, actorUserId: cashierId,
    reason: "ทดสอบยอดเครดิตคงเหลือ", idempotencyKey: key("void-offset-source"),
  } as any);
  assert.ok(
    String((voided as any).status).includes("VOID") || (voided as any).status === "PARTIAL_RETURNED",
    JSON.stringify(voided)
  );
  assert.equal(
    (await getArAccountByCustomer(tenantId, creditOffsetCustomerId))!.balance,
    -2000,
    "จ่ายครบแล้ว void ต้องกลายเป็นยอดที่ร้านค้างลูกค้า"
  );

  const next = await sell(
    "credit-offset-target",
    [{ method: "CREDIT", amount: 1000 }],
    { packQty: 1, customerId: creditOffsetCustomerId }
  );
  assert.equal(next.status, "SOLD", JSON.stringify(next));
  if (next.status !== "SOLD") return;

  const nextInvoice = await getArInvoiceByOrder(tenantId, next.orderId);
  const sourceInvoice = await getArInvoiceByOrder(tenantId, first.orderId);
  assert.equal(sourceInvoice!.status, "VOID", "ย้ายยอดเครดิตแล้วห้ามทำหลักฐาน void ของบิลต้นทางหาย");
  assert.equal(nextInvoice!.status, "PAID", "ยอดเครดิตเดิมครอบบิลใหม่ทั้งใบ บิลต้องไม่ค้างใน aging");
  assert.equal(nextInvoice!.outstanding, 0);
  assert.equal((await getArAccountByCustomer(tenantId, creditOffsetCustomerId))!.balance, -1000);
  assert.equal(
    (await listArInvoices(tenantId, { accountId: account!.id, openOnly: true })).length,
    0,
    "บัญชีติดลบแต่มีใบ OPEN พร้อมกัน = aging บอกให้ตามหนี้ทั้งที่ร้านเป็นฝ่ายค้างลูกค้า"
  );
});

// ---------------------------------------------------------------
// 4. ตัดหนี้สูญ + ตัวเลขที่ส่งบัญชี
// ---------------------------------------------------------------

test("ตัดหนี้สูญ: ใบยังอยู่ในระบบพร้อมเหตุผล และตัดซ้ำไม่ได้", async () => {
  const account = await getArAccountByCustomer(tenantId, customerId);
  const open = await listArInvoices(tenantId, { accountId: account!.id, openOnly: true });
  assert.ok(open.length > 0, "เทสนี้ต้องมีใบค้างเหลืออยู่");
  const target = open[0];

  const res = await writeOffArInvoice({
    tenantId, invoiceId: target.id, reason: "ลูกค้าปิดกิจการ", actorUserId: cashierId,
  });
  assert.equal(res.status, "WRITTEN_OFF", JSON.stringify(res));
  if (res.status !== "WRITTEN_OFF") return;
  assert.equal(res.amount, target.outstanding);

  const after = (await listArInvoices(tenantId, { accountId: account!.id }))
    .find((row) => row.id === target.id);
  assert.equal(after!.status, "WRITTEN_OFF", "หนี้ที่หายไปเฉย ๆ จากรายงานคือช่องให้ปิดบังการยักยอก");
  assert.equal(after!.outstanding, 0);

  const ledger = await listArLedger(tenantId, { invoiceId: target.id });
  const writeOff = ledger.find((row) => row.kind === "WRITE_OFF");
  assert.ok(writeOff, "การตัดหนี้สูญต้องมีร่องรอยในสมุดรายวัน");
  assert.equal(writeOff!.note, "ลูกค้าปิดกิจการ");

  const again = await writeOffArInvoice({
    tenantId, invoiceId: target.id, reason: "กดซ้ำ", actorUserId: cashierId,
  });
  assert.equal(again.status, "INVALID");
});

test("ตัดหนี้สูญต้องมีเหตุผลเสมอ", async () => {
  const account = await getArAccountByCustomer(tenantId, customerId);
  const open = await listArInvoices(tenantId, { accountId: account!.id, openOnly: true });
  if (open.length === 0) return;
  const res = await writeOffArInvoice({
    tenantId, invoiceId: open[0].id, reason: "   ", actorUserId: cashierId,
  });
  assert.equal(res.status, "INVALID");
});

test("ยอดในตารางบัญชีต้องเท่าผลรวมสมุดรายวันเสมอ", async () => {
  // ตัวเลขนี้ไม่ 0 = มีทางเขียนที่ลืมคำนวณยอดใหม่ ห้ามปิดงบด้วยตัวเลขชุดนี้
  const outstanding = await getArOutstanding(tenantId);
  assert.equal(outstanding.balanceMismatchCount, 0);

  const account = await getArAccountByCustomer(tenantId, customerId);
  const sum = await query<{ s: string }>(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM bms_ar_ledger WHERE tenant_id = $1 AND account_id = $2`,
    [tenantId, account!.id]
  );
  assert.equal(account!.balance, Number(sum.rows[0].s));
});

test("อายุหนี้: ใบที่เลยกำหนดต้องตกช่องที่ถูกต้อง ไม่ใช่กองรวมกับที่ยังไม่ถึงกำหนด", async () => {
  const account = await getArAccountByCustomer(tenantId, customerId);
  const open = await listArInvoices(tenantId, { accountId: account!.id, openOnly: true });
  if (open.length === 0) {
    // ไม่มีใบค้างเหลือ = เทสนี้ไม่มีอะไรให้ตรวจ แต่ต้องไม่เงียบ
    assert.fail("เทสอายุหนี้ต้องมีใบค้างอย่างน้อยหนึ่งใบ — ลำดับเทสเปลี่ยนไปแล้ว");
  }
  await query(
    `UPDATE bms_ar_invoices SET due_at = now() - INTERVAL '45 days' WHERE tenant_id = $1 AND id = $2`,
    [tenantId, open[0].id]
  );
  const aged = await getArOutstanding(tenantId);
  assert.ok(aged.aging.d31to60 >= open[0].outstanding, "ใบที่ค้าง 45 วันต้องอยู่ช่อง 31–60 วัน");
  assert.ok(aged.overdueAmount >= open[0].outstanding);

  const refreshed = (await listArInvoices(tenantId, { accountId: account!.id, overdueOnly: true }))
    .find((row) => row.id === open[0].id);
  assert.ok(refreshed, "ใบที่เลยกำหนดต้องอยู่ในตัวกรอง 'เฉพาะเลยกำหนด'");
  assert.equal(refreshed!.overdue, true);
  assert.ok(refreshed!.daysPastDue >= 44);
});

test("สรุปกะบอกได้ว่ากะนี้ปล่อยเชื่อไปเท่าไร เก็บกลับมาได้เท่าไร", async () => {
  const summary = await getArShiftSummary(tenantId, shiftId);
  assert.ok(summary.creditSalesCount > 0, "กะนี้ขายเชื่อไปแล้วแต่สรุปกะบอกว่าไม่มี");
  assert.ok(summary.collectedAmount > 0);
  assert.ok(
    summary.collectedCashAmount <= summary.collectedAmount,
    "ยอดเงินสดต้องเป็นส่วนหนึ่งของยอดที่เก็บได้ ไม่ใช่ยอดแยกที่บวกเพิ่ม"
  );
});

test("ปิดบัญชีที่ยังมีหนี้ค้างไม่ได้", async () => {
  const account = await getArAccountByCustomer(tenantId, customerId);
  if (Math.abs(account!.balance) < 0.005) {
    // ทำให้มีหนี้ก่อน เพื่อไม่ให้เทสนี้ผ่านด้วยเหตุผลผิด
    const sold = await sell("credit-closecheck", [{ method: "CREDIT", amount: 1000 }], { packQty: 1 });
    assert.equal(sold.status, "SOLD", JSON.stringify(sold));
  }
  const res = await upsertArAccount({
    tenantId, customerId, creditLimit: 5000, termsDays: 30, status: "CLOSED", actorUserId: cashierId,
  });
  assert.equal(res.status, "INVALID", "ปิดบัญชีทั้งที่มีหนี้ = หนี้หายจากรายงานโดยเงินยังไม่เข้า");
});

test("teardown: ลบทุกแถวที่ชุดนี้สร้าง", async () => {
  const all = await query<{ id: string }>(
    `SELECT DISTINCT order_id AS id FROM bms_order_items WHERE tenant_id = $1 AND product_sku = $2`,
    [tenantId, SKU]
  );
  const ids = Array.from(new Set([...orders, ...all.rows.map((r) => r.id)]));

  // ลูกหนี้ก่อน (ledger → receipts → invoices → accounts) เพราะ FK ผูกกันเป็นชั้น
  const accounts = await query<{ id: string }>(
    `SELECT id FROM bms_ar_accounts WHERE tenant_id = $1 AND customer_id = ANY($2::uuid[])`,
    [tenantId, [customerId, otherCustomerId, creditOffsetCustomerId]]
  );
  const accountIds = accounts.rows.map((r) => r.id);
  if (accountIds.length) {
    await query(`DELETE FROM bms_ar_ledger WHERE tenant_id = $1 AND account_id = ANY($2::uuid[])`, [tenantId, accountIds]);
    await query(`DELETE FROM bms_ar_receipts WHERE tenant_id = $1 AND account_id = ANY($2::uuid[])`, [tenantId, accountIds]);
    await query(`DELETE FROM bms_ar_invoices WHERE tenant_id = $1 AND account_id = ANY($2::uuid[])`, [tenantId, accountIds]);
    await query(`DELETE FROM bms_ar_accounts WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, accountIds]);
  }

  await query(`DELETE FROM bms_pos_cash_movements WHERE tenant_id = $1 AND shift_id = $2`, [tenantId, shiftId]);
  if (ids.length) {
    await query(`DELETE FROM bms_pos_refund_allocations WHERE tenant_id = $1
                  AND pos_return_id IN (SELECT id FROM bms_pos_returns WHERE tenant_id = $1 AND order_id = ANY($2::uuid[]))`,
      [tenantId, ids]);
    await query(`DELETE FROM bms_pos_return_items WHERE tenant_id = $1
                  AND pos_return_id IN (SELECT id FROM bms_pos_returns WHERE tenant_id = $1 AND order_id = ANY($2::uuid[]))`,
      [tenantId, ids]);
    await query(`DELETE FROM bms_pos_returns WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])`, [tenantId, ids]);
    await query(`DELETE FROM bms_payments WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])`, [tenantId, ids]);
    await query(`DELETE FROM bms_tax_documents WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])`, [tenantId, ids]);
    await query(`DELETE FROM bms_order_items WHERE order_id = ANY($1::uuid[])`, [ids]);
    await query(`DELETE FROM bms_orders WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, ids]);
  }
  await query(`DELETE FROM bms_pos_shifts WHERE tenant_id = $1 AND device_id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_pos_devices WHERE tenant_id = $1 AND id = $2`, [tenantId, deviceId]);
  // ต้องลบ movements ก่อน products (FK composite)
  await query(`DELETE FROM bms_stock_movements WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_inventory WHERE tenant_id = $1 AND product_sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku = $2`, [tenantId, SKU]);
  await query(`DELETE FROM bms_customers WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tenantId, [customerId, otherCustomerId]]);
  await query(`UPDATE bms_loyalty_settings SET enabled = TRUE WHERE tenant_id = $1`, [tenantId]);
});
