import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { query, getClient } from "../apps/web/lib/db.ts";
import { beginTenantTx } from "../apps/web/lib/bms/tenant.ts";
import { cancelOrder, shipOrderInTx } from "../apps/web/lib/bms/orders.ts";
import { createShipment } from "../apps/web/lib/bms/shipping.ts";
import { recordMovement } from "../apps/web/lib/bms/movements.ts";
import { createQuoteDraft, reviseQuote, transitionQuote, getQuote } from "../apps/web/lib/bms/salesQuotations.ts";

const sku = `FAKE-QUOTE-${randomUUID().slice(0, 8)}`;
let tenantId = "";
let locationId = "";
let customerId = "";
let preparerId = "";
let approverId = "";
let draftId = "";
let revisionId = "";
let orderId = "";
let pickupId = "";
let pickupOrderId = "";
const expiry = () => new Date(Date.now() + 7 * 86400_000).toISOString();
const key = () => `quote-test-${randomUUID()}`;
const draft = (requestKey: string, shippingFee: number | null) => ({
  locationId, customerId, projectName: "FAKE construction site", siteAddress: "FAKE site",
  deliveryTerms: "DELIVERY" as const, shippingFee, expiresAt: expiry(), requestKey,
  lines: [
    { sku, size: "STD", packCode: "BASE", qty: 2, agreedUnitPrice: 90 },
    { sku, size: "STD", packCode: "PALLET", qty: 1, agreedUnitPrice: 3500 },
  ],
});

test("setup: throwaway tenant, 2 staff, bag base stock, pallet selling pack", async () => {
  const exists = await query<{ reg: string | null }>(`SELECT to_regclass('bms_sales_quotations')::text AS reg`);
  assert.equal(exists.rows[0]?.reg, "bms_sales_quotations", "apply migration 10.133 to throwaway DB");
  tenantId = (await query<{ id: string }>(`SELECT id FROM bms_tenants WHERE id='11111111-1111-1111-1111-111111111111'`)).rows[0].id;
  const staff = await query<{ id: string }>(`SELECT id FROM users WHERE tenant_id=$1 ORDER BY id LIMIT 2`, [tenantId]);
  assert.equal(staff.rows.length, 2);
  [preparerId, approverId] = staff.rows.map((row) => row.id);
  locationId = (await query<{ id: string }>(
    `SELECT id FROM bms_locations WHERE tenant_id=$1 AND active ORDER BY is_head_office DESC,created_at LIMIT 1`, [tenantId]
  )).rows[0].id;
  customerId = (await query<{ id: string }>(
    `INSERT INTO bms_customers(tenant_id,name) VALUES ($1,'FAKE quote contract customer') RETURNING id`, [tenantId]
  )).rows[0].id;
  await query(`INSERT INTO bms_products(tenant_id,sku,name,price,active,vat_category)
    VALUES ($1,$2,'FAKE cement bag',100,true,'V')`, [tenantId,sku]);
  for (const surface of ["RETAIL_POS", "ONLINE_ORDER"]) {
    await query(`INSERT INTO bms_product_sales_surfaces(tenant_id,product_sku,surface,enabled)
      VALUES ($1,$2,$3,true) ON CONFLICT (tenant_id,product_sku,surface) DO UPDATE SET enabled=true`, [tenantId,sku,surface]);
  }
  await query(`INSERT INTO bms_inventory(tenant_id,location_id,product_sku,size,current_stock,reserved_stock)
    VALUES ($1,$2,$3,'STD',10,0)`, [tenantId,locationId,sku]);
  const initialClient = await getClient();
  try {
    await beginTenantTx(initialClient, tenantId);
    await recordMovement(initialClient, { tenantId, locationId, sku, size: "STD", type: "STOCK_IN",
      qty: 10, actor: "quote-contract-fixture", note: "FAKE initial stock" });
    await initialClient.query("COMMIT");
  } finally { initialClient.release(); }
  await query(`INSERT INTO bms_product_packs(tenant_id,product_sku,size,pack_code,unit_name,base_qty,price,is_base)
    VALUES ($1,$2,'STD','BASE','ถุง',1,100,true),($1,$2,'STD','PALLET','พาเลท',40,3600,false)`, [tenantId,sku]);
});

test("draft is idempotent, partial lines reject, and unknown freight cannot be approved", async () => {
  const requestKey = key();
  const input = draft(requestKey, null);
  const first = await createQuoteDraft(tenantId, preparerId, input);
  assert.equal(first.status, "DRAFT", JSON.stringify(first));
  assert.equal(first.total, null);
  draftId = first.quoteId!;
  const retry = await createQuoteDraft(tenantId, preparerId, input);
  assert.equal(retry.quoteId, draftId);
  assert.equal((await createQuoteDraft(tenantId, preparerId,
    { ...input, projectName: "changed" })).status, "IDEMPOTENCY_CONFLICT");
  assert.equal((await transitionQuote(tenantId, approverId, draftId, "APPROVE")).status, "SHIPPING_UNRESOLVED");
  const missingSite = await createQuoteDraft(tenantId, preparerId,
    { ...draft(key(), 0), siteAddress: "" });
  assert.equal(missingSite.status, "DRAFT");
  assert.equal((await transitionQuote(tenantId, approverId, missingSite.quoteId!, "APPROVE")).status,
    "SITE_ADDRESS_REQUIRED");
  await query(`DELETE FROM bms_sales_quotation_lines WHERE tenant_id=$1 AND quote_id=$2`, [tenantId,missingSite.quoteId]);
  await query(`DELETE FROM bms_sales_quotations WHERE tenant_id=$1 AND id=$2`, [tenantId,missingSite.quoteId]);
  const invalidKey = key();
  const invalid = await createQuoteDraft(tenantId, preparerId, { ...draft(invalidKey, 0),
    lines: [...input.lines, { sku: "FAKE-MISSING", size: "STD", qty: 1 }] });
  assert.equal(invalid.status, "INVALID_LINES");
  assert.deepEqual(invalid.issues, [{ line: 3, code: "PRODUCT_UNAVAILABLE" }]);
  assert.equal((await query(`SELECT count(*)::integer AS n FROM bms_sales_quotations WHERE tenant_id=$1 AND request_key=$2`,
    [tenantId, invalidKey]).then((x) => x.rows[0].n)), 0);
});

test("revision freezes agreed bag/pallet prices and requires another approver", async () => {
  const revised = await reviseQuote(tenantId, preparerId, draftId, draft(key(), 100));
  assert.equal(revised.status, "DRAFT", JSON.stringify(revised));
  assert.equal(revised.revisionNo, 2);
  assert.equal(revised.total, 3780);
  revisionId = revised.quoteId!;
  assert.equal((await getQuote(tenantId, preparerId, draftId))?.status, "SUPERSEDED");
  assert.equal((await transitionQuote(tenantId, preparerId, revisionId, "APPROVE")).status,
    "SECOND_APPROVER_REQUIRED");
  const approved = await transitionQuote(tenantId, approverId, revisionId, "APPROVE");
  assert.equal(approved.status, "APPROVED", JSON.stringify(approved));
  assert.equal((await transitionQuote(tenantId, preparerId, revisionId, "SEND")).status, "SENT");
  assert.equal((await transitionQuote(tenantId, preparerId, revisionId, "ACCEPT")).status,
    "ACCEPTANCE_EVIDENCE_REQUIRED");
  assert.equal((await transitionQuote(tenantId, preparerId, revisionId, "ACCEPT", "FAKE signed PO #123")).status, "ACCEPTED");
});

test("conversion rejects insufficient stock atomically; retry keeps quote price after catalog changes", async () => {
  const before = await query<{ current_stock: number; reserved_stock: number }>(
    `SELECT current_stock,reserved_stock FROM bms_inventory
      WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size='STD'`, [tenantId,locationId,sku]);
  const rejected = await transitionQuote(tenantId, preparerId, revisionId, "CONVERT");
  assert.equal(rejected.status, "ORDER_REJECTED", JSON.stringify(rejected));
  assert.equal(rejected.orderStatus, "INSUFFICIENT");
  const after = await query<{ current_stock: number; reserved_stock: number }>(
    `SELECT current_stock,reserved_stock FROM bms_inventory
      WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size='STD'`, [tenantId,locationId,sku]);
  assert.deepEqual(after.rows, before.rows);
  assert.equal((await getQuote(tenantId, preparerId, revisionId))?.status, "ACCEPTED");
  const topup = await getClient();
  try {
    await beginTenantTx(topup, tenantId);
    await topup.query(`UPDATE bms_inventory SET current_stock=current_stock+190 WHERE tenant_id=$1 AND location_id=$2
      AND product_sku=$3 AND size='STD'`, [tenantId,locationId,sku]);
    await recordMovement(topup, { tenantId, locationId, sku, size: "STD", type: "STOCK_IN",
      qty: 190, actor: "quote-contract-fixture", note: "FAKE topup" });
    await topup.query("COMMIT");
  } finally { topup.release(); }
  await query(`UPDATE bms_products SET price=120 WHERE tenant_id=$1 AND sku=$2`, [tenantId,sku]);
  await query(`UPDATE bms_product_packs SET price=4000 WHERE tenant_id=$1 AND product_sku=$2 AND pack_code='PALLET'`,
    [tenantId,sku]);
  const converted = await transitionQuote(tenantId, preparerId, revisionId, "CONVERT");
  assert.equal(converted.status, "CONVERTED", JSON.stringify(converted));
  orderId = converted.orderId!;
  assert.equal(converted.total, 3780);
  const retry = await transitionQuote(tenantId, preparerId, revisionId, "CONVERT");
  assert.equal(retry.orderId, orderId);
  const order = await query<{ total_amount: string; shipping_fee: string; quote_site_address: string;
    retail_fulfillment_type: string; fulfillment_type: string | null }>(
    `SELECT total_amount,shipping_fee,quote_site_address,retail_fulfillment_type,fulfillment_type
       FROM bms_orders WHERE tenant_id=$1 AND id=$2`, [tenantId,orderId]);
  assert.equal(Number(order.rows[0].total_amount), 3680);
  assert.equal(Number(order.rows[0].shipping_fee), 100);
  assert.equal(order.rows[0].quote_site_address, "FAKE site");
  assert.equal(order.rows[0].retail_fulfillment_type, "DELIVERY");
  assert.equal(order.rows[0].fulfillment_type, null);
  const lines = await query<{ pack_code: string; line_amount: string; qty: number }>(
    `SELECT pack_code,line_amount,qty FROM bms_order_items WHERE tenant_id=$1 AND order_id=$2 ORDER BY pack_code`,
    [tenantId,orderId]);
  assert.deepEqual(lines.rows.map((line) => [line.pack_code,Number(line.line_amount),Number(line.qty)]),
    [["BASE",180,2],["PALLET",3500,40]]);
  const stock = await query<{ reserved_stock: number }>(
    `SELECT reserved_stock FROM bms_inventory WHERE tenant_id=$1 AND location_id=$2 AND product_sku=$3 AND size='STD'`,
    [tenantId,locationId,sku]);
  assert.equal(Number(stock.rows[0].reserved_stock), 42);
});

test("quoted site delivery uses frozen destination and carrier booking fails closed", async () => {
  assert.equal((await createShipment({ tenantId, orderId, carrier: "OTHER", actor: preparerId })).status,
    "QUOTE_SITE_DELIVERY_UNSUPPORTED");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    await client.query(`UPDATE bms_orders SET status='PACKING' WHERE tenant_id=$1 AND id=$2`, [tenantId,orderId]);
    assert.equal(await shipOrderInTx(client, tenantId, orderId, preparerId), true);
    const stock = await client.query<{ current_stock: number; reserved_stock: number }>(
      `SELECT current_stock,reserved_stock FROM bms_inventory WHERE tenant_id=$1
        AND location_id=$2 AND product_sku=$3 AND size='STD'`, [tenantId,locationId,sku]);
    assert.equal(Number(stock.rows[0].current_stock), 158);
    assert.equal(Number(stock.rows[0].reserved_stock), 0);
  } finally { await client.query("ROLLBACK").catch(() => {}); client.release(); }
});

test("retail pickup stays separate from restaurant pickup and needs handover", async () => {
  const pickup = await createQuoteDraft(tenantId, preparerId, {
    ...draft(key(), 0), deliveryTerms: "PICKUP", siteAddress: "", lines: [{ sku, size: "STD", qty: 1 }],
  });
  assert.equal(pickup.status, "DRAFT", JSON.stringify(pickup));
  pickupId = pickup.quoteId!;
  assert.equal((await transitionQuote(tenantId, approverId, pickupId, "APPROVE")).status, "APPROVED");
  assert.equal((await transitionQuote(tenantId, preparerId, pickupId, "SEND")).status, "SENT");
  assert.equal((await transitionQuote(tenantId, preparerId, pickupId, "ACCEPT", "FAKE pickup confirmation")).status, "ACCEPTED");
  const converted = await transitionQuote(tenantId, preparerId, pickupId, "CONVERT");
  assert.equal(converted.status, "CONVERTED", JSON.stringify(converted));
  pickupOrderId = converted.orderId!;
  const fields = await query<{ retail_fulfillment_type: string; fulfillment_type: string | null;
    quote_site_address: string | null }>(
    `SELECT retail_fulfillment_type,fulfillment_type,quote_site_address FROM bms_orders
      WHERE tenant_id=$1 AND id=$2`, [tenantId,pickupOrderId]);
  assert.deepEqual(fields.rows[0], { retail_fulfillment_type: "PICKUP", fulfillment_type: null,
    quote_site_address: null });
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    await client.query(`UPDATE bms_orders SET status='PACKING' WHERE tenant_id=$1 AND id=$2`, [tenantId,pickupOrderId]);
    assert.equal(await shipOrderInTx(client, tenantId, pickupOrderId, preparerId), false);
    assert.equal(await shipOrderInTx(client, tenantId, pickupOrderId, preparerId, true), true);
  } finally { await client.query("ROLLBACK").catch(() => {}); client.release(); }
});

test("quote rows are tenant-isolated under bms_app RLS", async () => {
  const client = await getClient();
  try {
    await beginTenantTx(client, "22222222-2222-2222-2222-222222222222");
    const res = await client.query(`SELECT id FROM bms_sales_quotations WHERE id=$1`, [revisionId]);
    assert.equal(res.rowCount, 0);
  } finally { await client.query("ROLLBACK").catch(() => {}); client.release(); }
});

test("teardown: cancel reservation and remove quotation fixtures", async () => {
  if (orderId) await cancelOrder(tenantId, orderId);
  if (pickupOrderId) await cancelOrder(tenantId, pickupOrderId);
  await query(`DELETE FROM bms_sales_quotation_lines WHERE tenant_id=$1 AND quote_id=ANY($2::uuid[])`,
    [tenantId,[draftId,revisionId,pickupId]]);
  if (pickupId) await query(`DELETE FROM bms_sales_quotations WHERE tenant_id=$1 AND id=$2`, [tenantId,pickupId]);
  await query(`DELETE FROM bms_sales_quotations WHERE tenant_id=$1 AND id=$2`, [tenantId,revisionId]);
  await query(`DELETE FROM bms_sales_quotations WHERE tenant_id=$1 AND id=$2`, [tenantId,draftId]);
  if (orderId) {
    await query(`DELETE FROM bms_order_items WHERE tenant_id=$1 AND order_id=$2`, [tenantId,orderId]);
    await query(`DELETE FROM bms_orders WHERE tenant_id=$1 AND id=$2`, [tenantId,orderId]);
  }
  if (pickupOrderId) {
    await query(`DELETE FROM bms_order_items WHERE tenant_id=$1 AND order_id=$2`, [tenantId,pickupOrderId]);
    await query(`DELETE FROM bms_orders WHERE tenant_id=$1 AND id=$2`, [tenantId,pickupOrderId]);
  }
  await query(`DELETE FROM bms_stock_movements WHERE tenant_id=$1 AND product_sku=$2`, [tenantId,sku]);
  await query(`DELETE FROM bms_inventory WHERE tenant_id=$1 AND product_sku=$2`, [tenantId,sku]);
  await query(`DELETE FROM bms_product_packs WHERE tenant_id=$1 AND product_sku=$2`, [tenantId,sku]);
  await query(`DELETE FROM bms_products WHERE tenant_id=$1 AND sku=$2`, [tenantId,sku]);
  await query(`DELETE FROM bms_customers WHERE tenant_id=$1 AND id=$2`, [tenantId,customerId]);
});
