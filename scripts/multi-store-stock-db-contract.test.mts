import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { query } from "../apps/web/lib/db.ts";
import { cancelOrder, createOrder, releaseExpiredOrders } from "../apps/web/lib/bms/orders.ts";
import { createShipment } from "../apps/web/lib/bms/shipping.ts";
import { upsertProductModifier, upsertProductRecipe } from "../apps/web/lib/bms/productRecipes.ts";
import { upsertProductStockPolicy } from "../apps/web/lib/bms/productStockPolicies.ts";
import { resolvePosScan } from "../apps/web/lib/bms/pos.ts";
import { scaleBarcode } from "../apps/web/lib/bms/barcode.ts";
import { upsertStoreCapability } from "../apps/web/lib/bms/storeCapabilities.ts";
import { listInventoryWastage, recordInventoryWastage } from "../apps/web/lib/bms/wastage.ts";
import {
  cancelKitchenTicketsForOrderInTx,
  enqueueKitchenTicketsInTx,
  listKitchenTickets,
  updateKitchenTicketStatus,
} from "../apps/web/lib/bms/kitchen.ts";
import { beginTenantTx } from "../apps/web/lib/bms/tenant.ts";
import { getClient } from "../apps/web/lib/db.ts";

const TAG = "multi-store-stock-test";
const MENU = `FAKE-${TAG}-MENU`;
const RICE = `FAKE-${TAG}-RICE`;
const MEAT = `FAKE-${TAG}-MEAT`;
const EGG = `FAKE-${TAG}-EGG`;
const FLOUR = `FAKE-${TAG}-FLOUR`;
const SIZE = "BASE";

let tenantId = "";
let locationId = "";
let orderId = "";
let actorUserId = "";

const reserved = async (sku: string) => Number((await query<{ qty: string }>(
  `SELECT reserved_stock::text AS qty FROM bms_inventory
    WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
  [tenantId, locationId, sku, SIZE]
)).rows[0]?.qty ?? 0);

const onHand = async (sku: string) => Number((await query<{ qty: string }>(
  `SELECT current_stock::text AS qty FROM bms_inventory
    WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
  [tenantId, locationId, sku, SIZE]
)).rows[0]?.qty ?? 0);

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

test("setup a throwaway restaurant with an active recipe and modifier", async () => {
  tenantId = (await query<{ id: string }>(
    `INSERT INTO bms_tenants (name, slug) VALUES ($1,$2) RETURNING id`,
    [`FAKE ${TAG}`, `fake-${TAG}-${Date.now()}`]
  )).rows[0].id;
  locationId = (await query<{ id: string }>(
    `INSERT INTO bms_locations (tenant_id, code, name) VALUES ($1,'MAIN',$2) RETURNING id`,
    [tenantId, `FAKE ${TAG} branch`]
  )).rows[0].id;
  await query(
    `INSERT INTO bms_store_profile (tenant_id, business_archetype) VALUES ($1,'restaurant')`,
    [tenantId]
  );
  actorUserId = (await query<{ id: string }>(
    `INSERT INTO users (name, username, email, role, role_id, tenant_id, password_hash, fake_test)
     SELECT $2, $3, $3, 'Administrator', r.id, $1, 'x', TRUE
       FROM roles r WHERE r.name = 'Administrator' LIMIT 1
     RETURNING id`,
    [tenantId, `FAKE ${TAG} actor`, `fake-${TAG}-actor-${process.pid}@example.invalid`]
  )).rows[0].id;
  for (const [sku, price] of [[MENU, 80], [RICE, 1], [MEAT, 1], [EGG, 10], [FLOUR, 0.05]] as Array<[string, number]>) {
    await query(
      `INSERT INTO bms_products (tenant_id, sku, name, price, active, vat_category)
       VALUES ($1,$2,$3,$4,TRUE,'V')`,
      [tenantId, sku, sku, price]
    );
  }
  // 9.51 made a declared sales surface a precondition for selling. These products are
  // inserted straight into bms_products, so nothing else would declare one for them.
  for (const sku of [MENU, RICE, MEAT, EGG, FLOUR]) {
    // Every channel these fixtures are sold through below, including the online orders
    // used by the shipping and expiry-sweep tests.
    await declareSalesSurfaces(sku, [
      "RESTAURANT_POS", "RETAIL_POS", "ONLINE_ORDER", "PUBLIC_STOREFRONT", "CUSTOMER_AI",
    ]);
  }
  for (const sku of [RICE, MEAT, EGG, FLOUR]) {
    await query(
      `INSERT INTO bms_inventory
         (tenant_id, location_id, product_sku, size, current_stock, reserved_stock)
       VALUES ($1,$2,$3,$4,10000,0)`,
      [tenantId, locationId, sku, SIZE]
    );
  }
  await upsertProductRecipe(tenantId, {
    productSku: MENU,
    size: SIZE,
    active: true,
    items: [
      { sku: RICE, size: SIZE, qty: 200 },
      { sku: MEAT, size: SIZE, qty: 100 },
    ],
  });
  await upsertProductModifier(tenantId, {
    productSku: MENU,
    size: SIZE,
    code: "EXTRA_EGG",
    name: "Extra egg",
    priceDelta: 15,
    items: [{ sku: EGG, size: SIZE, qtyDelta: 1 }],
  });
  await upsertProductStockPolicy(tenantId, {
    productSku: MENU,
    stockPolicy: "RECIPE",
    baseUnit: "PORTION",
    kitchenStation: "HOT",
  });
  // Mixed business: restaurant preset plus a manually enabled weighed-product
  // capability. Archetype remains onboarding metadata, not a stock restriction.
  await upsertStoreCapability(tenantId, { capability: "WEIGHTED_PRODUCT", enabled: true });

  await upsertProductStockPolicy(tenantId, {
    productSku: FLOUR,
    stockPolicy: "WEIGHTED",
    baseUnit: "GRAM",
    displayUnit: "กรัม",
    scaleItemCode: "12345",
    scaleSize: SIZE,
  });
});

test("prefix-22 scale labels resolve exact grams while price labels fail closed", async () => {
  const weightLabel = scaleBarcode("WEIGHT", "12345", 750);
  const hit = await resolvePosScan(tenantId, weightLabel, { locationId });
  assert.ok(hit);
  assert.equal(hit?.sku, FLOUR);
  assert.equal(hit?.size, SIZE);
  assert.equal(hit?.baseQty, 750);
  assert.equal(hit?.packPrice, 37.5);
  assert.equal(hit?.scaleBarcode, weightLabel);

  const priceLabel = scaleBarcode("PRICE", "12345", 37.5);
  assert.equal(await resolvePosScan(tenantId, priceLabel, { locationId }), null);
});

/**
 * Prefix 21/22 only *look* like scale labels. `checkBarcode()` warns but never blocks, so a shop
 * can hold such a number as an ordinary product barcode, and the in-store generator covers the
 * whole 20–29 range. Consuming every scale-shaped code and returning null would leave those
 * products unscannable at the register with a bare "not found".
 */
test("a scale-shaped code that maps to nothing is still looked up as an ordinary barcode", async () => {
  const looksLikeScale = scaleBarcode("WEIGHT", "99999", 1);
  await query(`UPDATE bms_products SET barcode = $3 WHERE tenant_id = $1 AND sku = $2`,
    [tenantId, EGG, looksLikeScale]);

  const hit = await resolvePosScan(tenantId, looksLikeScale, { locationId });
  assert.ok(hit, "a product carrying a 22-prefixed barcode must remain scannable");
  assert.equal(hit?.sku, EGG);
  assert.equal(hit?.scaleBarcode ?? null, null, "it is an ordinary line, never a weighed one");
  assert.equal(hit?.baseQty, 1, "no quantity may be derived from a code we could not map");
});

test("createOrder reserves recipe ingredients and stores one immutable snapshot", async () => {
  const menuHit = await resolvePosScan(tenantId, MENU, { locationId, size: SIZE, packCode: "BASE" });
  assert.equal(menuHit?.modifiers[0]?.priceDelta, 15, "register preview reads the catalog surcharge");
  const result = await createOrder({
    tenantId,
    channel: "pos",
    locationId,
    items: [{ sku: MENU, size: SIZE, qty: 2, modifierCodes: ["EXTRA_EGG"] }],
  } as any);
  assert.equal(result.status, "CREATED", JSON.stringify(result));
  if (result.status !== "CREATED") return;
  orderId = result.orderId;
  assert.equal(result.total, 190, "2 × (menu 80 + extra egg 15)");
  assert.equal(result.items[0].receiptUnitPrice, 95);
  assert.equal(result.items[0].pricingSnapshot.modifierUnitPrice, 15);

  assert.equal(await reserved(RICE), 400);
  assert.equal(await reserved(MEAT), 200);
  assert.equal(await reserved(EGG), 2);
  assert.equal(await reserved(MENU), 0, "menu has a zero FK row but does not own stock");

  const snapshot = await query<{ product_sku: string; qty: number; source: string; meta: any }>(
    `SELECT c.product_sku, c.qty, c.source, c.meta
       FROM bms_order_item_stock_consumption c
       JOIN bms_order_items oi ON oi.tenant_id = c.tenant_id AND oi.id = c.order_item_id
      WHERE c.tenant_id = $1 AND oi.order_id = $2
      ORDER BY c.product_sku`,
    [tenantId, orderId]
  );
  assert.equal(snapshot.rowCount, 3);
  assert.deepEqual(
    Object.fromEntries(snapshot.rows.map((row) => [row.product_sku, Number(row.qty)])),
    { [EGG]: 2, [MEAT]: 200, [RICE]: 400 }
  );
  assert.ok(snapshot.rows.every((row) => Array.isArray(row.meta.sources)));

  const expanded = await query<{ product_sku: string; qty: number }>(
    `SELECT product_sku, qty FROM bms_order_stock_lines
      WHERE tenant_id = $1 AND order_id = $2 ORDER BY product_sku`,
    [tenantId, orderId]
  );
  assert.deepEqual(
    Object.fromEntries(expanded.rows.map((row) => [row.product_sku, Number(row.qty)])),
    { [EGG]: 2, [MEAT]: 200, [RICE]: 400 }
  );
});

test("cancellation releases the exact snapshot even after recipe configuration exists", async () => {
  assert.equal(await cancelOrder(tenantId, orderId), true);
  assert.equal(await reserved(RICE), 0);
  assert.equal(await reserved(MEAT), 0);
  assert.equal(await reserved(EGG), 0);
});

/**
 * `9.40` shipped the wastage ledger and the `WASTAGE` movement type but never widened
 * `bms_stock_movements_type_check` (still the eleven types from `7.98`), so every write-off
 * rolled back at the movement insert and the whole page was dead. `9.42` widens it. This test
 * exists because the original DB contract never called the write path at all — the code, the
 * resolver and the page all type-checked while the only thing that mattered could not run.
 */
test("a write-off moves unreserved stock and lands in ledger, movement and audit together", async () => {
  const before = await onHand(EGG);
  const { id } = await recordInventoryWastage({
    tenantId,
    locationId,
    productSku: EGG,
    size: SIZE,
    qty: 3,
    reason: `FAKE ${TAG} spoiled`,
    actorUserId,
  });
  assert.equal(await onHand(EGG), before - 3);

  const movement = await query<{ qty: string; note: string | null }>(
    `SELECT qty::text AS qty, note FROM bms_stock_movements
      WHERE tenant_id = $1 AND product_sku = $2 AND type = 'WASTAGE'`,
    [tenantId, EGG]
  );
  assert.equal(movement.rowCount, 1, "a write-off with no movement is stock that vanished");
  assert.equal(Number(movement.rows[0].qty), 3);

  const audited = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms_audit_log
      WHERE tenant_id = $1 AND action = 'inventory.wastage_recorded' AND target = $2`,
    [tenantId, id]
  );
  assert.equal(Number(audited.rows[0].n), 1);

  const history = await listInventoryWastage(tenantId);
  assert.equal(history.length, 1);
  assert.equal(history[0].productSku, EGG);
  assert.equal(history[0].qty, 3);
});

test("a write-off cannot take stock another bill has already reserved", async () => {
  const order = await createOrder({
    tenantId,
    channel: "pos",
    locationId,
    items: [{ sku: MENU, size: SIZE, qty: 1, modifierCodes: ["EXTRA_EGG"] }],
  } as any);
  assert.equal(order.status, "CREATED", JSON.stringify(order));
  if (order.status !== "CREATED") return;

  const available = await onHand(EGG) - await reserved(EGG);
  await assert.rejects(
    recordInventoryWastage({
      tenantId, locationId, productSku: EGG, size: SIZE,
      qty: available + 1, reason: `FAKE ${TAG} over`, actorUserId,
    }),
    /ไม่ถูกจอง/
  );
  assert.equal(await reserved(EGG), 1, "the rejected write-off must not touch the reservation");

  // Completed recipe lines become kitchen tickets; the same order enqueued twice must not
  // duplicate a ticket, because a retried sale is one dish, not two.
  const client = await getClient();
  try {
    // A shop that uses recipes only to deduct ingredients (food_beverage's preset has RECIPE but
    // no KITCHEN_WORKFLOW) must not accumulate tickets nobody can open or clear.
    await upsertStoreCapability(tenantId, { capability: "KITCHEN_WORKFLOW", enabled: false });
    assert.equal(await enqueueKitchenTicketsInTx(client, tenantId, order.orderId), 0,
      "no kitchen queue configured means no ticket, not a hidden one");
    await upsertStoreCapability(tenantId, { capability: "KITCHEN_WORKFLOW", enabled: true });
    assert.equal(await enqueueKitchenTicketsInTx(client, tenantId, order.orderId), 1);
    assert.equal(await enqueueKitchenTicketsInTx(client, tenantId, order.orderId), 0);
  } finally {
    client.release();
  }
  const tickets = await listKitchenTickets(tenantId);
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].productSku, MENU);
  assert.equal(tickets[0].station, "HOT");
  assert.deepEqual(tickets[0].modifierCodes, ["EXTRA_EGG"]);
  assert.equal(tickets[0].status, "NEW");

  const moved = await updateKitchenTicketStatus({
    tenantId, ticketId: tickets[0].id, status: "PREPARING", actorUserId,
  });
  assert.equal(moved.status, "PREPARING");
  await assert.rejects(
    updateKitchenTicketStatus({ tenantId, ticketId: tickets[0].id, status: "SERVED", actorUserId }),
    /PREPARING/,
    "a ticket must not skip READY — the board is the record of what actually happened"
  );
  assert.equal(await reserved(EGG), 1, "moving a ticket must never move stock");

  assert.equal(await cancelOrder(tenantId, order.orderId), true);
  // A cancelled bill must not stay on the kitchen board either — same reason as a void.
  const afterCancel = await query<{ status: string }>(
    `SELECT status FROM bms_kitchen_tickets WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, order.orderId]
  );
  assert.deepEqual(afterCancel.rows.map((row) => row.status), ["CANCELLED"]);
});

/**
 * Four places move stock and every one of them must read `bms_order_stock_lines`. Two did not:
 * `createShipment()` and `releaseExpiredOrders()` still read `bms_order_items`. On a derived line
 * the parent SKU owns a zero inventory row, so both ran straight into a CHECK — shipping could not
 * ship the bill at all, and one derived order in the expiry batch rolled back the whole cron so no
 * order was ever released. Broken for bundles since `8.8`; `9.40` made it every restaurant bill.
 */
test("shipping a menu bill deducts ingredients, not the zero row of the menu itself", async () => {
  const customerId = (await query<{ id: string }>(
    `INSERT INTO bms_customers (tenant_id, name, phone) VALUES ($1,$2,$3) RETURNING id`,
    [tenantId, `FAKE ${TAG} customer`, `FAKE-${TAG}-${process.pid}`]
  )).rows[0].id;
  await query(
    `INSERT INTO bms_customer_addresses (tenant_id, customer_id, label, address, address_type)
     VALUES ($1,$2,$3,$4,'shipping')`,
    [tenantId, customerId, `FAKE ${TAG} addr`, `FAKE ${TAG} address line`]
  );
  const order = await createOrder({
    tenantId, channel: "web", locationId, customerId,
    items: [{ sku: MENU, size: SIZE, qty: 1 }],
  } as any);
  assert.equal(order.status, "CREATED", JSON.stringify(order));
  if (order.status !== "CREATED") return;
  const riceOnHand = await onHand(RICE);
  const riceReserved = await reserved(RICE);
  await query(`UPDATE bms_orders SET status = 'PACKING' WHERE tenant_id = $1 AND id = $2`,
    [tenantId, order.orderId]);

  const shipment = await createShipment({
    tenantId, orderId: order.orderId, carrier: "OTHER", trackingNo: `FAKE-${TAG}-TRK`,
  } as any);
  assert.equal(shipment.status, "CREATED", JSON.stringify(shipment));

  assert.equal(await onHand(RICE), riceOnHand - 200, "ingredients must leave the shelf");
  assert.equal(await reserved(RICE), riceReserved - 200, "the reservation must be consumed, not stranded");
  assert.equal(await onHand(MENU), 0, "the menu's own row stays at zero, never negative");
});

/**
 * The expiry sweep used to be one transaction over every tenant in the database, so one bill it
 * could not release stopped every other shop's holds from ever being released — and the next run
 * met the same bill again. The local database was in exactly that state: 21 stale bills and a job
 * that threw on all of them. Now each bill gets its own transaction and a bad one is reported
 * instead of taking the run down.
 */
test("one unreleasable bill no longer blocks the rest of the sweep", async () => {
  const healthy = await createOrder({
    tenantId, channel: "web", locationId, items: [{ sku: MENU, size: SIZE, qty: 1 }],
  } as any);
  const broken = await createOrder({
    tenantId, channel: "web", locationId, items: [{ sku: EGG, size: SIZE, qty: 2 }],
  } as any);
  assert.equal(healthy.status, "CREATED", JSON.stringify(healthy));
  assert.equal(broken.status, "CREATED", JSON.stringify(broken));
  if (healthy.status !== "CREATED" || broken.status !== "CREATED") return;

  const riceReserved = await reserved(RICE);
  // Reservation drift: the bill still claims two eggs but the counter no longer records them.
  // Releasing it would drive reserved_stock negative — the real shape of the failure seen locally.
  await query(
    `UPDATE bms_inventory SET reserved_stock = 0
      WHERE tenant_id = $1 AND location_id = $2 AND product_sku = $3 AND size = $4`,
    [tenantId, locationId, EGG, SIZE]
  );
  await query(
    `UPDATE bms_orders SET created_at = now() - interval '30 days'
      WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tenantId, [healthy.orderId, broken.orderId]]
  );

  const swept = await releaseExpiredOrders(1, tenantId);
  assert.deepEqual(swept.orderIds, [healthy.orderId], "the healthy bill must still be released");
  assert.equal(swept.failed.length, 1, "the drifted bill must be reported, not thrown");
  assert.equal(swept.failed[0].orderId, broken.orderId);
  assert.ok(swept.failed[0].reason.includes("reserved_stock"), swept.failed[0].reason);
  assert.equal(await reserved(RICE), riceReserved - 200, "its ingredients came back");

  const statuses = await query<{ id: string; status: string }>(
    `SELECT id, status FROM bms_orders WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tenantId, [healthy.orderId, broken.orderId]]
  );
  const byId = Object.fromEntries(statuses.rows.map((row) => [row.id, row.status]));
  assert.equal(byId[healthy.orderId], "CANCELLED");
  assert.equal(byId[broken.orderId], "PENDING", "a bill that could not be released stays open");
});

/**
 * `SUM(bms_inventory_lots.qty) = bms_inventory.current_stock` is a documented invariant of
 * `lots.ts`, enforced only by every write going through that file. The write-off path moved the
 * summary row alone, so the lot layer kept the quantity it had just thrown in the bin — which is
 * the whole point of the feature for a restaurant or a pharmacy. The stale lot then stayed in the
 * FEFO queue and `reconcileLotTotals()` reported drift nobody could trace back.
 */
test("a write-off consumes the expiring lot first and keeps the lot total on the summary row", async () => {
  const stock = await onHand(FLOUR);
  await query(
    `INSERT INTO bms_inventory_lots
       (tenant_id, location_id, product_sku, size, lot_no, expiry_date, qty)
     VALUES ($1,$2,$3,$4,'EXPIRED','2020-01-01',100),
            ($1,$2,$3,$4,'FRESH','2999-01-01',$5)`,
    [tenantId, locationId, FLOUR, SIZE, stock - 100]
  );

  await recordInventoryWastage({
    tenantId, locationId, productSku: FLOUR, size: SIZE,
    qty: 150, reason: `FAKE ${TAG} expired flour`, actorUserId,
  });

  const lots = await query<{ lot_no: string; qty: string }>(
    `SELECT lot_no, qty::text AS qty FROM bms_inventory_lots
      WHERE tenant_id = $1 AND product_sku = $2 ORDER BY lot_no`,
    [tenantId, FLOUR]
  );
  const byLot = Object.fromEntries(lots.rows.map((row) => [row.lot_no, Number(row.qty)]));
  assert.equal(byLot.EXPIRED, 0, "the expired lot must be the one that leaves — not a good one");
  assert.equal(byLot.FRESH, stock - 100 - 50);
  assert.equal(byLot.EXPIRED + byLot.FRESH, await onHand(FLOUR),
    "lot total must equal the summary row or FEFO sells stock that is not there");

  // Lot layer short of the summary row: the write-off must fail loudly and roll back the
  // summary too, not half-apply and deepen the drift it just found.
  await query(
    `UPDATE bms_inventory_lots SET qty = 10 WHERE tenant_id = $1 AND product_sku = $2 AND lot_no = 'FRESH'`,
    [tenantId, FLOUR]
  );
  const beforeFailure = await onHand(FLOUR);
  await assert.rejects(
    recordInventoryWastage({
      tenantId, locationId, productSku: FLOUR, size: SIZE,
      qty: 50, reason: `FAKE ${TAG} drift`, actorUserId,
    }),
    /lot/
  );
  assert.equal(await onHand(FLOUR), beforeFailure, "a rejected write-off must not move the summary row");
});

/**
 * The board asked for tickets with no status filter, ordered by `created_at` ascending, capped at
 * the limit. A restaurant that has pushed more tickets than the cap therefore received the oldest
 * tickets of its life — all served — and no new ticket could ever appear again. The kitchen reads
 * that as "the register stopped sending orders" while the register is selling normally.
 */
test("the board shows the newest work first when the ticket cap is reached, and drops stale served ones", async () => {
  const first = await createOrder({
    tenantId, channel: "pos", locationId,
    items: [{ sku: MENU, size: SIZE, qty: 1 }],
  } as any);
  const second = await createOrder({
    tenantId, channel: "pos", locationId,
    items: [{ sku: MENU, size: SIZE, qty: 1 }],
  } as any);
  assert.equal(first.status, "CREATED", JSON.stringify(first));
  assert.equal(second.status, "CREATED", JSON.stringify(second));
  if (first.status !== "CREATED" || second.status !== "CREATED") return;

  const client = await getClient();
  try {
    assert.equal(await enqueueKitchenTicketsInTx(client, tenantId, first.orderId), 1);
    assert.equal(await enqueueKitchenTicketsInTx(client, tenantId, second.orderId), 1);
  } finally {
    client.release();
  }
  // The first ticket is finished business from two days ago.
  await query(
    `UPDATE bms_kitchen_tickets
        SET status = 'SERVED', created_at = now() - interval '2 days', updated_at = now() - interval '2 days'
      WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, first.orderId]
  );

  const capped = await listKitchenTickets(tenantId, null, 1);
  assert.equal(capped.length, 1);
  assert.equal(capped[0].orderId, second.orderId, "the cap must drop the oldest ticket, never the newest");
  assert.equal(capped[0].status, "NEW");

  const board = await listKitchenTickets(tenantId, null, 200);
  assert.deepEqual(board.map((row) => row.orderId), [second.orderId],
    "a ticket served two days ago is history, not today's board");
  const served = await listKitchenTickets(tenantId, "SERVED", 200);
  assert.deepEqual(served.map((row) => row.orderId), [first.orderId],
    "an explicit status filter must still reach older tickets");

  // Voiding a bill has to stop the kitchen: a ticket left open after the money went back is
  // food that gets cooked and thrown away with no record of why.
  const voidClient = await getClient();
  try {
    await beginTenantTx(voidClient, tenantId, { editorId: actorUserId });
    assert.equal(await cancelKitchenTicketsForOrderInTx(voidClient, tenantId, second.orderId), 1);
    assert.equal(await cancelKitchenTicketsForOrderInTx(voidClient, tenantId, second.orderId), 0,
      "a second void of the same bill must not re-cancel what is already closed");
    assert.equal(await cancelKitchenTicketsForOrderInTx(voidClient, tenantId, first.orderId), 0,
      "a served ticket stays served — the food did leave the kitchen");
    await voidClient.query("COMMIT");
  } catch (error) {
    try { await voidClient.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    voidClient.release();
  }
  const statuses = await query<{ status: string }>(
    `SELECT status FROM bms_kitchen_tickets WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, second.orderId]
  );
  assert.deepEqual(statuses.rows.map((row) => row.status), ["CANCELLED"]);

  assert.equal(await cancelOrder(tenantId, first.orderId), true);
  assert.equal(await cancelOrder(tenantId, second.orderId), true);
});

/**
 * NON_STOCK (9.52) — a menu that sells on day one with no ingredient or recipe setup.
 * It consumes nothing, so it writes no snapshot rows at all; the whole feature rests on
 * migration 9.52 excluding it from the view's legacy fallback branch.
 */
const NS_MENU = `FAKE-${TAG}-QUICKMENU`;
const NS_MENU2 = `FAKE-${TAG}-QUICKMENU2`;


test("a NON_STOCK menu sells with no stock movement and no ingredient setup", async () => {
  await query(
    `INSERT INTO bms_products (tenant_id, sku, name, price, cost_price, active, vat_category)
     VALUES ($1,$2,$3,120,45,TRUE,'V')`,
    [tenantId, NS_MENU, NS_MENU]
  );
  await declareSalesSurfaces(NS_MENU, ["RESTAURANT_POS", "RETAIL_POS"]);
  // 9.51 readiness: a sellable product needs at least one variant (or pack).
  await query(
    `INSERT INTO bms_product_variants (tenant_id, product_sku, code)
     VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [tenantId, NS_MENU, SIZE]
  );
  // No recipe, no ingredients, no modifiers — that is the whole point of the policy.
  await upsertProductStockPolicy(tenantId, {
    productSku: NS_MENU,
    stockPolicy: "NON_STOCK",
    baseUnit: "PIECE",
    kitchenStation: "HOT",
  });

  assert.equal(await onHand(NS_MENU), 0, "no inventory row exists before the first sale");

  const sale = await createOrder({
    tenantId,
    channel: "pos",
    locationId,
    items: [{ sku: NS_MENU, size: SIZE, qty: 3 }],
  } as any);
  assert.equal(sale.status, "CREATED", JSON.stringify(sale));
  if (sale.status !== "CREATED") return;
  assert.equal(sale.total, 360, "3 × 120");

  // (b) the FK row exists but stays pinned at zero on both sides, before and after.
  assert.equal(await onHand(NS_MENU), 0, "a NON_STOCK menu never owns stock");
  assert.equal(await reserved(NS_MENU), 0, "and never reserves any");

  // (a) nothing moved anywhere in the ledger for this SKU.
  assert.equal(Number((await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms_stock_movements
      WHERE tenant_id = $1 AND product_sku = $2`,
    [tenantId, NS_MENU]
  )).rows[0].n), 0, "a NON_STOCK sale must write no stock movement");

  assert.equal(Number((await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms_order_item_stock_consumption c
       JOIN bms_order_items oi ON oi.tenant_id = c.tenant_id AND oi.id = c.order_item_id
      WHERE c.tenant_id = $1 AND oi.order_id = $2`,
    [tenantId, sale.orderId]
  )).rows[0].n), 0, "zero consumption lines is the deliberate snapshot");

  // The view must agree: this sold line has no stock effect whatsoever.
  assert.equal(Number((await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms_order_stock_lines
      WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, sale.orderId]
  )).rows[0].n), 0, "the legacy fallback branch must not resurrect a NON_STOCK line");

  assert.equal(await cancelOrder(tenantId, sale.orderId), true);

  // A second quick menu that is never sold, kept for the scan test below.
  await query(
    `INSERT INTO bms_products (tenant_id, sku, name, price, cost_price, active, vat_category)
     VALUES ($1,$2,$3,60,20,TRUE,'V')`,
    [tenantId, NS_MENU2, NS_MENU2]
  );
  await declareSalesSurfaces(NS_MENU2, ["RESTAURANT_POS", "RETAIL_POS"]);
  await query(
    `INSERT INTO bms_product_variants (tenant_id, product_sku, code)
     VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [tenantId, NS_MENU2, SIZE]
  );
  await upsertProductStockPolicy(tenantId, {
    productSku: NS_MENU2, stockPolicy: "NON_STOCK", baseUnit: "PIECE",
  });
});

/**
 * (c) Mutation test, automated: drop the 9.52 predicate from the view, replay the exact sale
 * above, and prove it breaks. Without this predicate the view reads "no snapshot" as
 * "pre-9.40 row" and expands the menu into "consumes 1 unit of itself" against an inventory
 * row deliberately pinned at 0 — so every bill fails. The view is restored in `finally`.
 */
test("removing the 9.52 view predicate makes every NON_STOCK sale fail", async () => {
  const brokenLegacyBranch = `
    DROP VIEW IF EXISTS bms_order_stock_lines;
    CREATE VIEW bms_order_stock_lines AS
      SELECT oi.id AS order_item_id, oi.tenant_id, oi.order_id, oi.location_id,
             c.product_sku, c.size, c.qty
        FROM bms_order_items oi
        JOIN bms_order_item_stock_consumption c
          ON c.tenant_id = oi.tenant_id AND c.order_item_id = oi.id
      UNION ALL
      SELECT oi.id, oi.tenant_id, oi.order_id, oi.location_id, oi.product_sku, oi.size, oi.qty
        FROM bms_order_items oi
        JOIN bms_products p ON p.tenant_id = oi.tenant_id AND p.sku = oi.product_sku
       WHERE p.is_bundle IS NOT TRUE
         AND NOT EXISTS (
           SELECT 1 FROM bms_order_item_stock_consumption c
            WHERE c.tenant_id = oi.tenant_id AND c.order_item_id = oi.id
         )
      UNION ALL
      SELECT oi.id, oi.tenant_id, oi.order_id, oi.location_id,
             b.component_sku, b.component_size, (oi.qty * b.qty)::integer
        FROM bms_order_items oi
        JOIN bms_products p
          ON p.tenant_id = oi.tenant_id AND p.sku = oi.product_sku AND p.is_bundle
        JOIN bms_product_bundle_items b
          ON b.tenant_id = oi.tenant_id AND b.bundle_sku = oi.product_sku
       WHERE NOT EXISTS (
           SELECT 1 FROM bms_order_item_stock_consumption c
            WHERE c.tenant_id = oi.tenant_id AND c.order_item_id = oi.id
         );
    GRANT SELECT ON bms_order_stock_lines TO bms_app;`;

  const shippedView = readFileSync(
    path.join(import.meta.dirname, "..", "db/migrations/9.52__bms_product_non_stock_policy.sql"),
    "utf8"
  );
  const restore = shippedView.slice(
    shippedView.indexOf("DROP VIEW IF EXISTS bms_order_stock_lines;"),
    shippedView.indexOf("COMMENT ON VIEW")
  );
  assert.ok(restore.includes("<> 'NON_STOCK'"), "the restore text must be the shipped 9.52 view");

  let outcome: string | null = null;
  try {
    await query(brokenLegacyBranch);
    const sale = await createOrder({
      tenantId,
      channel: "pos",
      locationId,
      items: [{ sku: NS_MENU, size: SIZE, qty: 3 }],
    } as any);
    outcome = sale.status;
    if (sale.status === "CREATED") await cancelOrder(tenantId, sale.orderId);
  } catch (error) {
    outcome = `THREW:${(error as Error).message}`;
  } finally {
    await query(restore);
  }

  assert.notEqual(outcome, "CREATED",
    "without the 9.52 predicate a NON_STOCK menu must fail to sell — that is the bug it prevents");

  // and the restored view is the shipped one again
  const sane = await createOrder({
    tenantId,
    channel: "pos",
    locationId,
    items: [{ sku: NS_MENU, size: SIZE, qty: 1 }],
  } as any);
  assert.equal(sane.status, "CREATED", "restoring the shipped view must make the sale work again");
  if (sane.status === "CREATED") await cancelOrder(tenantId, sane.orderId);
});

test("a mixed bill returns the DIRECT line only — NON_STOCK was never deducted", async () => {
  const before = await reserved(EGG);
  const sale = await createOrder({
    tenantId,
    channel: "pos",
    locationId,
    items: [
      { sku: NS_MENU, size: SIZE, qty: 2 },
      { sku: EGG, size: SIZE, qty: 4 },
    ],
  } as any);
  assert.equal(sale.status, "CREATED", JSON.stringify(sale));
  if (sale.status !== "CREATED") return;
  assert.equal(await reserved(EGG), before + 4, "the DIRECT line reserves normally");
  assert.equal(await reserved(NS_MENU), 0, "the NON_STOCK line reserves nothing");

  assert.equal(await cancelOrder(tenantId, sale.orderId), true);
  assert.equal(await reserved(EGG), before, "cancelling returns only what was actually taken");
  assert.equal(await reserved(NS_MENU), 0);
  assert.equal(await onHand(NS_MENU), 0, "nothing may be credited back to a NON_STOCK menu");
});

test("a NON_STOCK menu sold on a plain retail register still reaches the kitchen board", async () => {
  await upsertStoreCapability(tenantId, { capability: "KITCHEN_WORKFLOW", enabled: true });
  const sale = await createOrder({
    tenantId, channel: "pos", locationId,
    items: [{ sku: NS_MENU, size: SIZE, qty: 1 }],
  } as any);
  assert.equal(sale.status, "CREATED", JSON.stringify(sale));
  if (sale.status !== "CREATED") return;

  const client = await getClient();
  let created = 0;
  try {
    await beginTenantTx(client, tenantId, { editorId: actorUserId });
    created = await enqueueKitchenTicketsInTx(client, tenantId, sale.orderId);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
  assert.equal(created, 1, "the cook still has to cook it — a NON_STOCK menu needs a ticket");

  const tickets = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms_kitchen_tickets WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, sale.orderId]
  );
  assert.equal(Number(tickets.rows[0].n), 1);
  assert.equal(await cancelOrder(tenantId, sale.orderId), true);
});

test("a never-sold NON_STOCK menu is scannable at a register", async () => {
  // Before this fix the size COALESCE read only bms_inventory/packs, so a menu that had
  // never been sold (and therefore had no stock row) resolved to size NULL and could not
  // be added to a bill. RETAIL_POS is already declared for NS_MENU by the setup helper.
  const stockRows = Number((await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms_inventory
      WHERE tenant_id = $1 AND product_sku = $2`,
    [tenantId, NS_MENU2]
  )).rows[0].n);
  assert.equal(stockRows, 0, "this menu must have no inventory row for the test to mean anything");

  const hit = await resolvePosScan(tenantId, NS_MENU2, { locationId, packCode: "BASE" });
  assert.ok(hit, "a quick menu that was never sold must still scan");
  assert.equal(hit?.size, SIZE, "size comes from the catalog variant, not the stock table");
  assert.equal(hit?.sku, NS_MENU2);
});

test("a NON_STOCK menu can be upgraded to RECIPE later without losing data", async () => {
  await upsertProductRecipe(tenantId, {
    productSku: NS_MENU,
    size: SIZE,
    active: true,
    items: [{ sku: RICE, size: SIZE, qty: 150 }],
  });
  await upsertProductStockPolicy(tenantId, {
    productSku: NS_MENU,
    stockPolicy: "RECIPE",
    baseUnit: "PORTION",
    kitchenStation: "HOT",
  });
  const policy = (await query<{ stock_policy: string }>(
    `SELECT stock_policy FROM bms_product_stock_policies
      WHERE tenant_id = $1 AND product_sku = $2`,
    [tenantId, NS_MENU]
  )).rows[0];
  assert.equal(policy.stock_policy, "RECIPE", "no leftover recipe/modifier guard may block the upgrade");

  const rice = await reserved(RICE);
  const sale = await createOrder({
    tenantId, channel: "pos", locationId,
    items: [{ sku: NS_MENU, size: SIZE, qty: 2 }],
  } as any);
  assert.equal(sale.status, "CREATED", JSON.stringify(sale));
  if (sale.status !== "CREATED") return;
  assert.equal(await reserved(RICE), rice + 300, "after the upgrade it consumes ingredients");
  assert.equal(await cancelOrder(tenantId, sale.orderId), true);

  // No revert here: upsertProductStockPolicy deliberately refuses to leave RECIPE while an
  // active recipe exists, so this upgrade test must be the last one to touch NS_MENU.
});

test("teardown the throwaway tenant", async () => {
  const stale = await query<{ id: string }>(
    `SELECT id FROM bms_tenants WHERE slug LIKE $1`, [`fake-${TAG}-%`]
  );
  const ids = [...new Set([tenantId, ...stale.rows.map((row) => row.id)].filter(Boolean))];
  if (!ids.length) return;
  for (const table of [
    "bms_kitchen_tickets", "bms_inventory_wastage", "bms_audit_log", "bms_shipments",
    "bms_inventory_lots",
    "bms_customer_addresses",
    "bms_order_item_stock_consumption", "bms_order_items", "bms_order_discounts", "bms_orders",
    "bms_stock_movements", "bms_product_modifier_items", "bms_product_modifiers",
    "bms_product_recipe_items", "bms_product_recipes", "bms_product_stock_policies",
    "bms_product_variants", "bms_product_sales_surfaces",
    "bms_inventory", "bms_products", "bms_store_capabilities", "bms_store_profile",
    "bms_locations", "bms_customers", "users",
  ]) {
    await query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [ids]);
  }
  await query(`DELETE FROM bms_tenants WHERE id = ANY($1::uuid[])`, [ids]);
  assert.equal(Number((await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM bms_tenants WHERE id = ANY($1::uuid[])`, [ids]
  )).rows[0].n), 0);
});
