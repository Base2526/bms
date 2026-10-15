import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  readRestaurantItemSnapshot, allocateRestaurantSnapshot,
  ensureRestaurantItemSnapshotsInTx, restaurantOrderItemsInTx, type RestaurantItemSnapshot,
} from "../apps/web/lib/bms/restaurantItemSnapshots.ts";
import { priceRemainingLines } from "../apps/web/lib/bms/pricing.ts";
import { isRestaurantCheckError } from "../apps/web/lib/bms/restaurantPosErrors.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const snapshot = (): RestaurantItemSnapshot => ({
  version: 1, provenance: "FIRST_SEND", sourceOrderId: "order-a", sourceOrderItemId: "123", qty: 3,
  costAmount: 100, costSource: "CATALOG_AT_SALE",
  consumption: { soldSku: "MENU", soldSize: "PLATE", derived: true,
    lines: [{ sku: "RICE", size: "GRAM", qty: 300, source: "RECIPE", sourceRef: "recipe-v1", meta: { recipeVersion: 1 } }] },
});

test("snapshot validation preserves recipe identity, cost and modifier metadata", () => {
  const s = snapshot();
  assert.deepEqual(readRestaurantItemSnapshot(s, "MENU", "PLATE", 3), s);
  const allocated = allocateRestaurantSnapshot(s, [1, 2]);
  assert.deepEqual(allocated.map(a => a.consumption.lines[0].qty), [100, 200]);
  assert.deepEqual(allocated.map(a => a.costAmount), [33.33, 66.67]);
  assert.ok(allocated.every(a => a.consumption.lines[0].sourceRef === "recipe-v1"));
  assert.equal(s.consumption.lines[0].qty, 300, "never mutate the original evidence");
});

test("legacy allocation conserves cents even with many tiny equal portions", () => {
  const s = snapshot(); s.qty = 7; s.costAmount = 0.04; s.consumption.lines[0].qty = 7;
  const split = allocateRestaurantSnapshot(s, Array(7).fill(1));
  assert.equal(Math.round(split.reduce((a, b) => a + b.costAmount!, 0) * 100), 4);
  assert.ok(split.every(s => s.costAmount! >= 0));
});

test("unknown cost remains unknown and explicit empty consumption remains empty", () => {
  const s = snapshot(); s.costAmount = null; s.costSource = "MISSING"; s.consumption.lines = [];
  const split = allocateRestaurantSnapshot(s, [1, 2]);
  assert.ok(split.every(a => a.costAmount === null && a.costSource === "MISSING" && !a.consumption.lines.length));
});

test("malformed or mismatched JSON fails closed instead of loading today's recipe", () => {
  for (const patch of [{ version: 2 }, { qty: 4 }, { qty: 1.5 }, { costAmount: -1 },
    { costSource: "MISSING" }, { costAmount: Infinity }, { sourceOrderId: "" }, { consumption: null }]) {
    assert.throws(() => readRestaurantItemSnapshot({ ...snapshot(), ...patch }, "MENU", "PLATE", 3), /REVIEW_REQUIRED/);
  }
  const s = snapshot(); s.consumption.lines.push({ ...s.consumption.lines[0] });
  assert.throws(() => readRestaurantItemSnapshot(s, "MENU", "PLATE", 3), /REVIEW_REQUIRED/);
  assert.throws(() => readRestaurantItemSnapshot(snapshot(), "FOREIGN", "PLATE", 3), /REVIEW_REQUIRED/);
  assert.throws(() => readRestaurantItemSnapshot(snapshot(), "MENU", "OTHER", 3), /REVIEW_REQUIRED/);
});

test("legacy stock must divide exactly and quantities must cover the complete source line", () => {
  const s = snapshot(); s.consumption.lines[0].qty = 100;
  assert.throws(() => allocateRestaurantSnapshot(s, [1, 2]), /REVIEW_REQUIRED/);
  assert.throws(() => allocateRestaurantSnapshot(snapshot(), [1]), /REVIEW_REQUIRED/);
  assert.throws(() => allocateRestaurantSnapshot(snapshot(), [0, 3]), /REVIEW_REQUIRED/);
});

test("malformed stock entries produce an actionable domain rejection, not a masked server error", () => {
  const s = snapshot(); s.consumption.lines = [null as any];
  assert.throws(() => readRestaurantItemSnapshot(s, "MENU", "PLATE", 3),
    (error: unknown) => isRestaurantCheckError(error) && error.code === "RESTAURANT_SNAPSHOT_REVIEW_REQUIRED");
  const large = snapshot(); large.qty = 2147483647; large.consumption.lines[0].qty = 2147483647;
  large.costAmount = 999999999999.99;
  const split = allocateRestaurantSnapshot(large, [2147483646, 1]);
  assert.deepEqual(split.map(s => s.consumption.lines[0].qty), [2147483646, 1]);
  assert.equal(Math.round(split.reduce((sum, s) => sum + s.costAmount!, 0) * 100), Math.round(large.costAmount * 100));
});

function harness() {
  const rows: any[] = [1, 2].map((qty, i) => ({ id: `item-${i}`, check_id: "check-a", tenant_id: "tenant-a",
    product_sku: "MENU", size: "PLATE", pack_qty: qty, base_qty: 1, pack_code: "BASE", unit_name: "plate",
    pack_price: null, modifier_codes: [], status: "SENT", stock_snapshot: null }));
  const source: any[] = [{ id: "123", order_id: "order-a", product_sku: "MENU", size: "PLATE", pack_code: "BASE",
    qty: 3, stock_modifier_codes: [], restaurant_check_item_id: null, stock_consumption_version: 1,
    cost_amount_snapshot: "100.00", cost_snapshot_source: "CATALOG_AT_SALE" }];
  const stock: any[] = [{ product_sku: "RICE", size: "GRAM", qty: 300, source: "RECIPE", source_ref: "recipe-v1", meta: { recipeVersion: 1 } }];
  const calls: string[] = [];
  const result = (r: any[]) => ({ rows: structuredClone(r), rowCount: r.length });
  const client: any = { async query(sql: string, params: any[]) {
    calls.push(sql);
    assert.equal(params[0], "tenant-a", "every read/write must be tenant-scoped");
    if (sql.includes("SELECT id FROM bms_restaurant_checks")) return result(params[1] === "check-a" && params[2] === "branch-a" ? [{ id: "check-a" }] : []);
    if (sql.includes("SELECT * FROM bms_restaurant_check_items")) return result(rows.filter(r => r.check_id === params[1] && r.status !== "CANCELLED"));
    if (sql.includes("SELECT oi.*")) return result(source);
    if (sql.includes("FROM bms_order_item_stock_consumption")) return result(stock);
    if (sql.startsWith("UPDATE bms_restaurant_check_items")) {
      const row = rows.find(r => r.id === params[1]);
      if (row && row.stock_snapshot == null) row.stock_snapshot = JSON.parse(params[2]);
      return result(row ? [row] : []);
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  return { rows, source, stock, calls, client };
}

test("legacy capture uses only persisted order evidence and labels its limited provenance", async () => {
  const h = harness();
  await ensureRestaurantItemSnapshotsInTx(h.client, "tenant-a", "check-a");
  assert.deepEqual(h.rows.map(r => r.stock_snapshot.costAmount), [33.33, 66.67]);
  assert.ok(h.rows.every(r => r.stock_snapshot.provenance === "LEGACY_RESERVATION"));
  assert.ok(h.calls.every(sql => !sql.includes("FROM bms_products") && !sql.includes("FROM bms_product_recipes")));
  h.stock[0].qty = 999; h.source[0].cost_amount_snapshot = "999";
  await ensureRestaurantItemSnapshotsInTx(h.client, "tenant-a", "check-a");
  assert.equal(h.rows[0].stock_snapshot.consumption.lines[0].qty, 100, "retry never refreshes a saved snapshot");
});

test("server loads distinct line identities and never freezes NEW provisional reservations", async () => {
  const h = harness();
  await ensureRestaurantItemSnapshotsInTx(h.client, "tenant-a", "check-a");
  h.rows[1].status = "NEW"; h.rows[1].stock_snapshot = null;
  const items = await restaurantOrderItemsInTx(h.client, "tenant-a", "check-a", "branch-a");
  assert.deepEqual(items.map(i => i.restaurantCheckItemId), ["item-0", "item-1"]);
  assert.equal(items[0].restaurantStockSnapshot?.consumption.lines[0].sourceRef, "recipe-v1");
  assert.equal(items[1].restaurantStockSnapshot, undefined);
  assert.equal(h.rows[1].stock_snapshot, null);
  await assert.rejects(restaurantOrderItemsInTx(h.client, "tenant-a", "check-a", "foreign-branch"), /REVIEW_REQUIRED/);
  await assert.rejects(restaurantOrderItemsInTx(h.client, "tenant-a", "foreign-check", "branch-a"), /REVIEW_REQUIRED/);
});

test("legacy provisional quantities may include NEW rows but only SENT rows become immutable", async () => {
  const h = harness(); h.rows[1].status = "NEW";
  await ensureRestaurantItemSnapshotsInTx(h.client, "tenant-a", "check-a");
  assert.equal(h.rows[0].stock_snapshot.qty, 1);
  assert.equal(h.rows[1].stock_snapshot, null);
});

test("missing, ambiguous, empty legacy and indivisible evidence all refuse reconstruction", async () => {
  for (const change of [
    (h: ReturnType<typeof harness>) => h.source.splice(0),
    (h: ReturnType<typeof harness>) => h.source.push({ ...h.source[0], id: "456" }),
    (h: ReturnType<typeof harness>) => h.stock.splice(0),
    (h: ReturnType<typeof harness>) => { h.stock[0].qty = 1; },
  ]) {
    const h = harness(); change(h);
    await assert.rejects(ensureRestaurantItemSnapshotsInTx(h.client, "tenant-a", "check-a"), /REVIEW_REQUIRED/);
    assert.ok(h.rows.every(r => r.stock_snapshot === null));
  }
});

test("explicit v2 no-stock evidence is safe even if today's catalog has become a recipe", async () => {
  const h = harness(); h.source[0].stock_consumption_version = 2; h.stock.splice(0);
  await ensureRestaurantItemSnapshotsInTx(h.client, "tenant-a", "check-a");
  assert.deepEqual(h.rows[0].stock_snapshot.consumption.lines, []);
});

const promoLine = (id: number, qty: number, group: string | undefined = "MENU/PLATE") => ({
  id, sku: "MENU", size: "PLATE", qty, packQty: qty, returnedPackQty: 0,
  receiptUnitPrice: 60, packUnitPrice: null, promotionGroup: group,
  pricingSnapshot: { source: "SALE", priceTiers: [], modifierUnitPrice: 0,
    promotion: { kind: "N_FOR_PRICE", buyQty: 3, bundlePrice: 100 } },
});

test("return promotion spans restaurant rounds and recomputes after partial return", () => {
  const lines = [promoLine(1, 1), promoLine(2, 2)];
  assert.equal(priceRemainingLines(lines).pricingSubtotal, 100);
  assert.equal(priceRemainingLines(lines, new Map([[2, 1]])).pricingSubtotal, 120);
  assert.equal(priceRemainingLines(lines, new Map([[1, 1], [2, 2]])).pricingSubtotal, 0);
});

test("named packs and variants never unlock a loose promotion in another group", () => {
  const pack = { ...promoLine(2, 2), packUnitPrice: 40 };
  assert.equal(priceRemainingLines([promoLine(1, 1), pack]).pricingSubtotal, 140);
  assert.equal(priceRemainingLines([promoLine(1, 1), { ...promoLine(2, 2), size: "OTHER" }]).pricingSubtotal, 180);
  const retail = [promoLine(1, 1), promoLine(2, 2)].map(({ promotionGroup, ...line }) => line);
  assert.equal(priceRemainingLines(retail).pricingSubtotal, 180, "ordinary retail behavior remains unchanged");
});

test("round-level promotion allocations conserve cents and never create a negative last line", () => {
  const lines = Array.from({ length: 7 }, (_, index) => {
    const line = promoLine(index + 1, 1);
    line.pricingSnapshot.promotion = { kind: "N_FOR_PRICE", buyQty: 7, bundlePrice: 0.04 };
    return line;
  });
  const priced = priceRemainingLines(lines);
  assert.equal(priced.pricingSubtotal, 0.04);
  assert.ok(priced.lines.every(line => line.amount >= 0));
  const modifiers = [promoLine(1, 1), promoLine(2, 2)];
  modifiers[1].receiptUnitPrice = 65; modifiers[1].pricingSnapshot.modifierUnitPrice = 5;
  assert.equal(priceRemainingLines(modifiers).pricingSubtotal, 110, "modifier surcharge is added after the shared promotion");
});

test("migration and call sites pin evidence before row moves and retain one reservation/return path", () => {
  const sql = read("db/migrations/10.61__bms_restaurant_item_snapshots.sql");
  assert.match(sql, /FOREIGN KEY \(tenant_id, restaurant_check_item_id\)/);
  assert.equal((sql.match(/oi.stock_consumption_version < 2/g) ?? []).length, 2);
  assert.match(sql, /GRANT SELECT ON bms_order_stock_lines TO bms_app/);
  assert.match(sql, /WHERE restaurant_check_item_id IS NULL/);
  const orders = read("apps/web/lib/bms/orders.ts");
  assert.match(orders, /items = await restaurantOrderItemsInTx/);
  assert.match(orders, /resolvedConsumption.push\(snapshot.consumption\)/);
  assert.match(orders, /it.restaurantStockSnapshot \? it.restaurantStockSnapshot.costAmount/);
  assert.match(orders, /status='NEW' AND stock_snapshot IS NULL/);
  assert.match(orders, /RESTAURANT_PACK_CHANGED/);
  const restaurant = read("apps/web/lib/bms/restaurantPos.ts");
  const move = restaurant.slice(restaurant.indexOf("async function moveCheckItemsInTx"));
  assert.ok(move.indexOf("ensureRestaurantItemSnapshotsInTx") < move.indexOf("WITH picked AS"));
  assert.equal((restaurant.match(/freezeRestaurantItems: true/g) ?? []).length, 1);
  assert.match(restaurant, /oi.restaurant_check_item_id = ci.id/);
  assert.match(read("apps/web/lib/bms/pos.ts"), /Number\(item.stock_consumption_version\) !== 2/);
});
