// Writes to a local throwaway database only. Run through run-contract-tests.mjs db.
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { getClient, query } from "../apps/web/lib/db.ts";
import { cashierHasPermission, issuePosDeviceToken, openPosShift, recordPosSale,
  listRecentPosSales, partiallyReturnPosSale, processPosReturn, returnPosSale, setCashierPin, upsertPosDevice } from "../apps/web/lib/bms/pos.ts";
import { getSalesEvidence } from "../apps/web/lib/bms/salesEvidence.ts";
import { getProfitSummary } from "../apps/web/lib/bms/reports.ts";
import { DECLARE_FAKE_SALES_SURFACES_SQL } from "./testing/salesSurfaces.mts";

const tag = `FAKE-POS-OPEN-${process.pid}`;
const key = (name: string) => `${tag}-${name}-${randomUUID()}`;
let tenantId = "", locationId = "", deviceId = "", shiftId = "", cashierId = "", orderId = "";

test("setup retail register with a manager-authorized cashier", async () => {
  const tenant = await query<{ id: string; location_id: string; user_id: string }>(
    `SELECT t.id, l.id AS location_id, u.id AS user_id FROM bms_tenants t
       JOIN bms_store_profile s ON s.tenant_id=t.id
       JOIN bms_locations l ON l.tenant_id=t.id AND l.active
       JOIN users u ON u.tenant_id=t.id JOIN roles r ON r.id=u.role_id AND r.name='Administrator'
      WHERE COALESCE(s.business_archetype,'general') NOT IN ('pharmacy','restaurant','board_game_cafe')
      ORDER BY t.created_at LIMIT 1`);
  assert.ok(tenant.rows[0], "restored DB needs a general retail tenant with Administrator");
  ({ id: tenantId, location_id: locationId, user_id: cashierId } = tenant.rows[0]);
  await query(`UPDATE bms_store_profile SET cash_rounding='NONE',currency='THB' WHERE tenant_id=$1`, [tenantId]);
  const device = await upsertPosDevice(tenantId, { locationId, code: tag, name: tag, active: true });
  deviceId = device.id;
  await issuePosDeviceToken(tenantId, deviceId);
  await setCashierPin(tenantId, cashierId, "8246");
  const shift = await openPosShift({ tenantId, deviceId, openedBy: cashierId, openingFloat: 1000 });
  assert.ok(shift.status === "OPENED" || shift.status === "ALREADY_OPEN", JSON.stringify(shift));
  shiftId = shift.shift.id;
  assert.equal(await cashierHasPermission(tenantId, cashierId, "pos.open_item.sell"), true);
});

test("cash open-only sale is immutable, in receipt amount, and idempotent", async () => {
  const input = { tenantId, deviceId, shiftId, cashierUserId: cashierId, idempotencyKey: key("sale"),
    lines: [], openItems: [{ label: `${tag} scarf`, qty: 2, unitAmount: 19.99, vatCategory: "V" as const }],
    payments: [{ method: "CASH" as const, amount: 39.98, cashTendered: 40 }] };
  const sold = await recordPosSale(input);
  assert.equal(sold.status, "SOLD", JSON.stringify(sold));
  if (sold.status !== "SOLD") return;
  orderId = sold.orderId;
  const replay = await recordPosSale(input);
  assert.equal(replay.status, "SOLD");
  if (replay.status === "SOLD") assert.equal(replay.orderId, orderId);
  const rows = await query<{ qty: number; unit_amount: string; line_amount: string }>(
    `SELECT qty,unit_amount,line_amount FROM bms_order_open_items WHERE tenant_id=$1 AND order_id=$2`,
    [tenantId, orderId]);
  assert.equal(rows.rowCount, 1);
  assert.equal(Number(rows.rows[0].line_amount), 39.98);
  const stock = await query(`SELECT 1 FROM bms_stock_movements WHERE tenant_id=$1 AND ref_order_id=$2 LIMIT 1`, [tenantId, orderId]);
  assert.equal(stock.rowCount, 0);
});

test("non-cash open sale fails without an order", async () => {
  const refused = await recordPosSale({ tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("qr"), lines: [],
    openItems: [{ label: tag, qty: 1, unitAmount: 10, vatCategory: "N" }],
    payments: [{ method: "QR", amount: 10 }] });
  assert.equal(refused.status, "PAYMENT_FAILED");
});

test("open-item receipt keeps the cashier's entry order", async () => {
  const sold = await recordPosSale({ tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("receipt-order"), lines: [],
    openItems: [
      { label: `${tag} zebra`, qty: 1, unitAmount: 12, vatCategory: "N" },
      { label: `${tag} apple`, qty: 1, unitAmount: 8, vatCategory: "N" },
    ], payments: [{ method: "CASH", amount: 20, cashTendered: 20 }] });
  assert.equal(sold.status, "SOLD", JSON.stringify(sold));
  if (sold.status !== "SOLD") return;
  assert.deepEqual(sold.extraLines.map((line) => line.label), [`${tag} zebra`, `${tag} apple`]);
});

test("cashier without the open-item permission cannot create a sale", async () => {
  const idempotencyKey = key("permission-denied");
  const refused = await recordPosSale({ tenantId, deviceId, shiftId, cashierUserId: randomUUID(),
    idempotencyKey, lines: [],
    openItems: [{ label: tag, qty: 1, unitAmount: 10, vatCategory: "N" }],
    payments: [{ method: "CASH", amount: 10, cashTendered: 10 }] });
  assert.equal(refused.status, "PAYMENT_FAILED");
  const orders = await query(`SELECT 1 FROM bms_orders WHERE tenant_id=$1 AND idempotency_key=$2`,
    [tenantId, idempotencyKey]);
  assert.equal(orders.rowCount, 0);
});

test("RLS hides open lines for another tenant under bms_app", async () => {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE bms_app");
    await client.query("SELECT set_config('bms.tenant_id',$1,true)", [randomUUID()]);
    const hidden = await client.query(`SELECT id FROM bms_order_open_items WHERE order_id=$1`, [orderId]);
    assert.equal(hidden.rowCount, 0);
    await client.query("SELECT set_config('bms.tenant_id',$1,true)", [tenantId]);
    const visible = await client.query(`SELECT id FROM bms_order_open_items WHERE order_id=$1`, [orderId]);
    assert.equal(visible.rowCount, 1);
  } finally { await client.query("ROLLBACK"); client.release(); }
});

test("app role can append but cannot rewrite sale or return open-item evidence", async () => {
  const rights = await query<{ sale_insert: boolean; sale_update: boolean; sale_delete: boolean;
    return_insert: boolean; return_update: boolean; return_delete: boolean }>(
    `SELECT has_table_privilege('bms_app','bms_order_open_items','INSERT') AS sale_insert,
            has_table_privilege('bms_app','bms_order_open_items','UPDATE') AS sale_update,
            has_table_privilege('bms_app','bms_order_open_items','DELETE') AS sale_delete,
            has_table_privilege('bms_app','bms_pos_return_open_items','INSERT') AS return_insert,
            has_table_privilege('bms_app','bms_pos_return_open_items','UPDATE') AS return_update,
            has_table_privilege('bms_app','bms_pos_return_open_items','DELETE') AS return_delete`
  );
  assert.deepEqual(rights.rows[0], {
    sale_insert: true, sale_update: false, sale_delete: false,
    return_insert: true, return_update: false, return_delete: false,
  });
});

test("receipt history and sales evidence retain the open item without a catalog SKU", async () => {
  const receipts = await listRecentPosSales(tenantId, deviceId, 20, { query: `${tag} scarf` });
  const receipt = receipts.find(row => row.orderId === orderId);
  assert.ok(receipt, "sale can be found by its open-item label");
  assert.ok(receipt.lines.some(line => line.sku === "" && line.receiptName === `${tag} scarf`));
  const day = (await query<{ day: string }>(`SELECT to_char(now() AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') AS day`)).rows[0].day;
  const evidence = await getSalesEvidence(tenantId, cashierId,
    { from: day, to: day, locationId, channel: "pos" });
  assert.ok(evidence.eventCount > 0);
  assert.ok(evidence.missingCostLines > 0, "open item cost remains unknown");
  const profit = await getProfitSummary(tenantId, day, day, locationId);
  assert.equal(profit.complete, false, "unknown open-item cost cannot become zero profit cost");
});

test("full return refunds open lines without stock movement", async () => {
  const returned = await returnPosSale({ tenantId, deviceId, shiftId, orderId, actorUserId: cashierId,
    approvedByUserId: cashierId, note: tag, idempotencyKey: key("return") });
  assert.equal(returned.status, "RETURNED", JSON.stringify(returned));
  const rows = await query<{ qty: number; refund_amount: string }>(
    `SELECT ri.qty,ri.refund_amount FROM bms_pos_return_open_items ri
       JOIN bms_pos_returns r ON r.tenant_id=ri.tenant_id AND r.id=ri.pos_return_id
      WHERE ri.tenant_id=$1 AND r.order_id=$2`, [tenantId, orderId]);
  assert.equal(rows.rowCount, 1);
  assert.equal(Number(rows.rows[0].qty), 2);
  assert.equal(Number(rows.rows[0].refund_amount), 39.98);
  const receipts = await listRecentPosSales(tenantId, deviceId, 20, { query: `${tag} scarf` });
  const receipt = receipts.find(row => row.orderId === orderId);
  assert.ok(receipt?.returnEvents.some(event => event.items.some(item => item.orderItemId < 0)));
});

test("partial return of an open line refunds only the selected quantity", async () => {
  const sold = await recordPosSale({ tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("partial-sale"), lines: [],
    openItems: [{ label: `${tag} partial`, qty: 2, unitAmount: 10, vatCategory: "N" }],
    payments: [{ method: "CASH", amount: 20, cashTendered: 20 }] });
  assert.equal(sold.status, "SOLD", JSON.stringify(sold));
  if (sold.status !== "SOLD") return;
  const line = (await query<{ id: string }>(`SELECT id FROM bms_order_open_items WHERE tenant_id=$1 AND order_id=$2`,
    [tenantId, sold.orderId])).rows[0];
  const input = { tenantId, deviceId, shiftId, orderId: sold.orderId, actorUserId: cashierId,
    approvedByUserId: cashierId, idempotencyKey: key("partial-return"),
    lines: [{ orderItemId: -Number(line.id), packQty: 1 }] };
  const returned = await partiallyReturnPosSale(input);
  assert.equal(returned.status, "PARTIAL_RETURNED", JSON.stringify(returned));
  if (returned.status === "PARTIAL_RETURNED") assert.equal(returned.refundAmount, 10);
  const replay = await partiallyReturnPosSale(input);
  assert.equal(replay.status, "PARTIAL_RETURNED");
  if (replay.status === "PARTIAL_RETURNED") {
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.returnedItems, returned.status === "PARTIAL_RETURNED" ? returned.returnedItems : []);
  }
  const changedLines = await partiallyReturnPosSale({
    ...input,
    lines: [{ orderItemId: -Number(line.id), packQty: 2 }],
  });
  assert.equal(changedLines.status, "IDEMPOTENCY_CONFLICT");
  const changedAction = await processPosReturn({
    ...input,
    mode: "PARTIAL",
    isVoid: true,
  });
  assert.equal(changedAction.status, "IDEMPOTENCY_CONFLICT");
  const malformedSelection = await partiallyReturnPosSale({
    ...input,
    idempotencyKey: key("malformed-return"),
    lines: [
      { orderItemId: -Number(line.id), packQty: 1 },
      { orderItemId: 0, packQty: 1 },
    ],
  });
  assert.equal(malformedSelection.status, "EMPTY");
  const rows = await query<{ qty: number }>(`SELECT qty FROM bms_pos_return_open_items WHERE tenant_id=$1 AND order_open_item_id=$2`,
    [tenantId, line.id]);
  assert.equal(rows.rowCount, 1);
  assert.equal(Number(rows.rows[0].qty), 1);
});

test("mixed catalog and open sale moves stock only for the catalog line", async () => {
  const sku = `${tag}-SKU`;
  await query(`UPDATE bms_store_profile SET vat_registered=TRUE, price_includes_vat=TRUE, vat_rate=7
               WHERE tenant_id=$1`, [tenantId]);
  await query(`INSERT INTO bms_products(tenant_id,sku,name,price,active,vat_category)
               VALUES ($1,$2,$3,20,TRUE,'V')`, [tenantId, sku, sku]);
  await query(DECLARE_FAKE_SALES_SURFACES_SQL, [tenantId]);
  await query(`INSERT INTO bms_inventory(tenant_id,location_id,product_sku,size,current_stock,reserved_stock)
               VALUES ($1,$2,$3,'M',10,0)`, [tenantId, locationId, sku]);
  const sold = await recordPosSale({ tenantId, deviceId, shiftId, cashierUserId: cashierId,
    idempotencyKey: key("mixed-sale"), lines: [{ sku, size: "M", packQty: 1 }],
    openItems: [{ label: `${tag} no sku`, qty: 1, unitAmount: 5, vatCategory: "N" }],
    payments: [{ method: "CASH", amount: 25, cashTendered: 25 }] });
  assert.equal(sold.status, "SOLD", JSON.stringify(sold));
  if (sold.status !== "SOLD") return;
  const count = await query<{ catalog: string; open: string; stock: string }>(
    `SELECT (SELECT COUNT(*) FROM bms_order_items WHERE tenant_id=$1 AND order_id=$2)::text AS catalog,
            (SELECT COUNT(*) FROM bms_order_open_items WHERE tenant_id=$1 AND order_id=$2)::text AS open,
            (SELECT current_stock FROM bms_inventory WHERE tenant_id=$1 AND location_id=$3 AND product_sku=$4 AND size='M')::text AS stock`,
    [tenantId, sold.orderId, locationId, sku]);
  assert.deepEqual(count.rows[0], { catalog: "1", open: "1", stock: "9" });
  const tax = await query<{ taxable_amount: string; exempt_amount: string; grand_total: string }>(
    `SELECT taxable_amount,exempt_amount,grand_total FROM bms_tax_documents
      WHERE tenant_id=$1 AND order_id=$2 AND doc_type='ABBREVIATED'`, [tenantId, sold.orderId]);
  assert.equal(tax.rowCount, 1, "the cash sale issues an abbreviated invoice");
  assert.equal(Number(tax.rows[0].taxable_amount), 20);
  assert.equal(Number(tax.rows[0].exempt_amount), 5);
  assert.equal(Number(tax.rows[0].grand_total), 25);
});
