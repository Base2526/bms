// =============================================================
// Sales commission (8.5)
// -------------------------------------------------------------
// Two things here are easy to build wrong and nearly impossible to fix later,
// so most of this suite is about them:
//
//   1. The rate must come from the DAY OF THE SALE, not from today. A shop that
//      raises 2% to 3% must still see 2% when it reopens last month's report,
//      or the numbers in the system stop matching the payslips already handed
//      out and the report is worthless for checking anything.
//
//   2. Returned goods must remove their commission. Otherwise "sell it, have
//      the customer bring it back tomorrow" is a way to farm commission, and it
//      is one of the hardest frauds to spot because every individual step looks
//      correct.
//
// Run from apps/web:
//   POSTGRES_HOST=localhost POSTGRES_DB=bms POSTGRES_USER=app POSTGRES_PASSWORD=... \
//   npx tsx --import ../../scripts/testing/next-runtime-shim.mjs \
//     --test --test-concurrency=1 --test-force-exit \
//     ../../scripts/commission-db-contract.test.mts
//
// Writes to whatever database it is pointed at. Dev only.
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";

import { query } from "../apps/web/lib/db.ts";
import {
  getCommissionReport,
  listCommissionRules,
  upsertCommissionRule,
  deleteCommissionRule,
} from "../apps/web/lib/bms/commission.ts";
import {
  issuePosDeviceToken,
  openPosShift,
  partiallyReturnPosSale,
  recordPosSale,
  setCashierPin,
  upsertPosDevice,
  voidPosSale,
} from "../apps/web/lib/bms/pos.ts";

const TAG = "commission-test";
const SKU = `FAKE-${TAG}-A`;
const SKU_HOT = `FAKE-${TAG}-HOT`;
const SKU_PACK = `FAKE-${TAG}-PACK`;
const SIZE = "M";
const PIN = "3155";
/**
 * "วันนี้" ต้องเป็นวันของร้าน ไม่ใช่ของ UTC
 *
 * `getCommissionReport()` ตัดช่วงวันด้วย `AT TIME ZONE 'Asia/Bangkok'` (ถูกต้อง — รายงานคอมของ
 * ร้านไทยต้องเป็นวันตามหน้าร้าน) แต่บรรทัดนี้เคยคำนวณจาก `toISOString()` ซึ่งเป็น UTC · ผลคือ
 * **ทุกคืนระหว่าง 00:00–07:00 เวลาไทย** ชุดนี้แดง 6 ตัวโดยที่โค้ดไม่มีอะไรผิด: บิลที่เพิ่งขาย
 * ตกอยู่ในวันพรุ่งนี้ของกรุงเทพ ขณะที่ช่วงที่ขอไปคือเมื่อวานของกรุงเทพ (เจอตอนรัน 01:06 +07)
 * เทสที่แดงตามเวลาของวันคือเทสที่คนเลิกอ่าน
 */
const TODAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

let tenantId = "";
let locationId = "";
let deviceId = "";
let cashierId = "";
let shiftId = "";
let firstOrderId = "";

const key = (n: string) => `${TAG}-${n}-${process.pid}`;
const report = () => getCommissionReport(tenantId, TODAY, TODAY);
const mine = async () => (await report()).rows.find((r) => r.staffId === cashierId);

test("setup: two products at ฿1,000, a register, an open shift", async () => {
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
  // ปิดโปรแกรมสมาชิกไว้ ไม่ให้ส่วนลดชั้น/แต้มมากวนตัวเลขคอม
  await query(`UPDATE bms_loyalty_settings SET enabled = FALSE WHERE tenant_id = $1`, [tenantId]);

  for (const [sku, category] of [[SKU, null], [SKU_HOT, `${TAG}-CAT`], [SKU_PACK, null]] as Array<[string, string | null]>) {
    await query(
      `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category, category)
       VALUES ($1,$2,$3,1000,TRUE,'V',$4)
       ON CONFLICT (tenant_id, sku) DO UPDATE
         SET price = 1000, active = TRUE, category = EXCLUDED.category`,
      [tenantId, sku, `FAKE ${TAG} ${sku}`, category]
    );
    await query(
      `INSERT INTO bms_inventory (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
       VALUES ($1,$2,$3,$4,500,0)
       ON CONFLICT (tenant_id, location_id, product_sku, size)
         DO UPDATE SET current_stock = 500, reserved_stock = 0`,
      [tenantId, locationId, sku, SIZE]
    );
  }
  await query(`DELETE FROM bms_commission_rules WHERE tenant_id = $1`, [tenantId]);
  await query(
    `INSERT INTO bms_product_packs
       (tenant_id, product_sku, size, pack_code, unit_name, base_qty, price, active)
     VALUES ($1,$2,$3,'BOX','กล่อง',10,800,TRUE)
     ON CONFLICT (tenant_id, product_sku, pack_code) DO UPDATE
       SET size = EXCLUDED.size, base_qty = 10, price = 800, active = TRUE`,
    [tenantId, SKU_PACK, SIZE]
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
  const opened = await openPosShift({ tenantId, deviceId, openedBy: cashierId, openingFloat: 20000 });
  if (opened.status === "OPENED" || opened.status === "ALREADY_OPEN") shiftId = opened.shift.id;
});

test("with no rules configured the report says so instead of showing zeros as fact", async () => {
  const r = await report();
  assert.equal(r.noRulesConfigured, true,
    "ต้องบอกว่ายังไม่ตั้งอัตรา ไม่ใช่ปล่อยให้อ่านว่า 'คอมเป็นศูนย์'");
});

test("the default rate applies to everything sold", async () => {
  await upsertCommissionRule({
    tenantId, scope: "DEFAULT", percent: 2, effectiveFrom: TODAY, createdBy: cashierId,
  });

  const sale = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("s1"),
    lines: [{ sku: SKU, size: SIZE, packQty: 3 }],   // 3,000
    payments: [{ method: "CASH", amount: 3000, cashTendered: 3000 }],
  } as any);
  assert.equal(sale.status, "SOLD", JSON.stringify(sale));
  if (sale.status !== "SOLD") return;
  firstOrderId = sale.orderId;

  const row = await mine();
  assert.equal(row?.grossSales, 3000);
  assert.equal(row?.commission, 60, "2% ของ 3,000");
});

test("a product rule beats a category rule, which beats the default", async () => {
  await upsertCommissionRule({
    tenantId, scope: "CATEGORY", ref: `${TAG}-CAT`, percent: 5, effectiveFrom: TODAY, createdBy: cashierId,
  });
  const sale = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("s2"),
    lines: [{ sku: SKU_HOT, size: SIZE, packQty: 1 }],   // 1,000 · หมวด 5%
    payments: [{ method: "CASH", amount: 1000, cashTendered: 1000 }],
  } as any);
  assert.equal(sale.status, "SOLD", JSON.stringify(sale));

  let row = await mine();
  assert.equal(row?.commission, 60 + 50, "หมวดชนะอัตราเริ่มต้น");

  // อัตราเจาะจงสินค้าต้องชนะหมวด
  await upsertCommissionRule({
    tenantId, scope: "PRODUCT", ref: SKU_HOT, percent: 10, effectiveFrom: TODAY, createdBy: cashierId,
  });
  row = await mine();
  assert.equal(row?.commission, 60 + 100, "สินค้าชนะหมวด");
});

test("a bill-level discount is spread across lines, so commission follows the money received", async () => {
  // ขาย 2,000 แล้วลดมือ 500 → คอมต้องคิดบน 1,500 ไม่ใช่ 2,000
  const sale = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("disc"),
    lines: [{ sku: SKU, size: SIZE, packQty: 2 }],
    payments: [{ method: "CASH", amount: 1500, cashTendered: 1500 }],
    manualDiscount: 500,
    discountApprovedBy: cashierId,
    discountReason: "ทดสอบเกลี่ยส่วนลด",
  } as any);
  assert.equal(sale.status, "SOLD", JSON.stringify(sale));

  const row = await mine();
  // 60 + 100 (ก่อนหน้า) + 2% ของ 1,500 = 30
  assert.equal(row?.commission, 160 + 30,
    "ถ้าไม่เกลี่ยส่วนลด จะจ่ายคอมบนยอดที่ร้านไม่ได้รับจริง");
});

test("commission follows the sold pack amount instead of base-unit shelf price", async () => {
  const before = await mine();
  const sale = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("pack"),
    lines: [{ sku: SKU_PACK, size: SIZE, packQty: 1, packCode: "BOX" }],
    payments: [{ method: "CASH", amount: 800, cashTendered: 800 }],
  } as any);
  assert.equal(sale.status, "SOLD", JSON.stringify(sale));

  const after = await mine();
  assert.equal(Math.round((after!.grossSales - before!.grossSales) * 100) / 100, 800,
    "กล่อง 10 ชิ้นราคา 800 ต้องไม่กลายเป็นยอดหน้าชั้น 10,000");
  assert.equal(Math.round((after!.commission - before!.commission) * 100) / 100, 16,
    "คอม 2% ต้องคิดจากราคา pack ที่รับเงินจริง");
});

test("returned goods take their commission back", async () => {
  const before = await mine();

  const items = await query<{ id: number }>(
    `SELECT id FROM bms_order_items WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, firstOrderId]
  );
  const ret = await partiallyReturnPosSale({
    tenantId, deviceId, shiftId, orderId: firstOrderId, actorUserId: cashierId,
    approvedByUserId: cashierId, note: "คืน 1 ชิ้น",
    lines: [{ orderItemId: Number(items.rows[0].id), packQty: 1 }],
    idempotencyKey: key("ret"),
  } as any);
  assert.equal(ret.status, "PARTIAL_RETURNED", JSON.stringify(ret));

  const after = await mine();
  assert.equal(after!.returnedSales, 1000, "1 ชิ้นจาก 3 ที่ราคา 1,000");
  assert.equal(after!.commission, Math.round((before!.commission - 20) * 100) / 100,
    "คอมของชิ้นที่คืนต้องถูกดึงกลับ ไม่งั้นขาย-ให้คืน = ปั๊มคอมฟรี");
});

test("a voided bill earns nothing", async () => {
  const before = await mine();
  const sale = await recordPosSale({
    tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("void-sale"),
    lines: [{ sku: SKU, size: SIZE, packQty: 5 }],
    payments: [{ method: "CASH", amount: 5000, cashTendered: 5000 }],
  } as any);
  assert.equal(sale.status, "SOLD");
  if (sale.status !== "SOLD") return;

  const mid = await mine();
  assert.ok(mid!.commission > before!.commission, "ก่อน void ต้องนับก่อน");

  const voided = await voidPosSale({
    tenantId, deviceId, shiftId, orderId: sale.orderId,
    actorUserId: cashierId, approvedByUserId: cashierId,
    reason: "กดผิด", idempotencyKey: key("void"),
  });
  assert.equal(voided.status, "VOIDED", JSON.stringify(voided));

  const after = await mine();
  assert.equal(after!.commission, before!.commission, "บิลที่ยกเลิกต้องไม่เหลือคอมติดอยู่");
});

test("changing the rate today does not restate what was already earned", async () => {
  const beforeChange = await mine();

  // ขึ้นอัตราโดยให้มีผล "พรุ่งนี้" — ยอดของวันนี้ต้องไม่ขยับ
  const tomorrow = new Date(new Date(TODAY).getTime() + 86_400_000).toISOString().slice(0, 10);
  await upsertCommissionRule({
    tenantId, scope: "DEFAULT", percent: 50, effectiveFrom: tomorrow, createdBy: cashierId,
  });
  const afterFuture = await mine();
  assert.equal(afterFuture!.commission, beforeChange!.commission,
    "กฎที่ยังไม่มีผลต้องไม่ถูกใช้กับบิลเก่า");

  // และกฎที่เพิ่มย้อนหลังต้องใช้ได้จริง (ร้านตกลงย้อนหลังเป็นเรื่องปกติ)
  const rules = await listCommissionRules(tenantId);
  assert.ok(rules.some((x) => x.effectiveFrom === tomorrow && x.percent === 50));
  assert.ok(rules.length >= 4, "แก้อัตราคือเพิ่มแถวใหม่ ไม่ใช่ทับแถวเดิม");
});

test("the effective date survives the round trip in +07:00", async () => {
  // pg คืน DATE เป็น Date ที่เที่ยงคืนเวลาท้องถิ่น · การทำ .toISOString().slice(0,10)
  // จึงถอยไปวันก่อนหน้าทั้งหมดในโซนไทย ซึ่งแปลว่าอัตราของวันแรกที่ขึ้นราคาถูกใช้ผิด
  // (บั๊กจริงที่เทสชุดนี้จับได้ตอนเขียน — แก้ด้วยการให้ Postgres cast เป็น text)
  const pinned = "2030-03-01";
  await upsertCommissionRule({
    tenantId, scope: "PRODUCT", ref: SKU, percent: 7.5,
    effectiveFrom: pinned, note: "date round trip", createdBy: cashierId,
  });
  const rule = (await listCommissionRules(tenantId)).find((r) => r.note === "date round trip");
  assert.ok(rule, "ต้องหาแถวที่เพิ่งใส่เจอ");
  assert.equal(rule!.effectiveFrom, pinned, "วันต้องกลับมาเป็นวันเดิม ไม่เลื่อน");
  assert.equal(rule!.percent, 7.5, "ทศนิยมของอัตราต้องไม่หาย");
});

test("teardown: remove every row this suite created", async () => {
  const orders = await query<{ id: string }>(
    `SELECT id FROM bms_orders WHERE tenant_id = $1 AND pos_device_id = $2`, [tenantId, deviceId]
  );
  const ids = orders.rows.map((r) => r.id);
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
    await query(`DELETE FROM bms_order_discounts WHERE tenant_id = $1 AND order_id = ANY($2::uuid[])`, [tenantId, ids]);
    await query(`DELETE FROM bms_orders WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, ids]);
  }
  for (const rule of await listCommissionRules(tenantId)) await deleteCommissionRule(tenantId, rule.id);
  await query(`DELETE FROM bms_pos_cash_movements WHERE tenant_id = $1 AND device_id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_pos_shifts WHERE tenant_id = $1 AND device_id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_pos_devices WHERE tenant_id = $1 AND id = $2`, [tenantId, deviceId]);
  await query(`DELETE FROM bms_stock_movements WHERE tenant_id = $1 AND product_sku = ANY($2::text[])`,
    [tenantId, [SKU, SKU_HOT]]);
  await query(`DELETE FROM bms_inventory WHERE tenant_id = $1 AND product_sku = ANY($2::text[])`,
    [tenantId, [SKU, SKU_HOT]]);
  await query(`DELETE FROM bms_products WHERE tenant_id = $1 AND sku = ANY($2::text[])`, [tenantId, [SKU, SKU_HOT]]);
  await query(`UPDATE bms_loyalty_settings SET enabled = TRUE WHERE tenant_id = $1`, [tenantId]);
});
