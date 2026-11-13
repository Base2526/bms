import assert from "node:assert/strict";
import test from "node:test";
import { qualityStock, usableStockSql } from "../apps/web/lib/bms/lotQuality.ts";
import { consumeOrderLotsInTx } from "../apps/web/lib/bms/orderLots.ts";

test("lot-tracked stock without source lots cannot be offered or reserved", async () => {
  const client = { query: async (sql: string) => {
    if (sql.includes("FROM bms_inventory WHERE")) return { rows: [{ current_stock: 5, reserved_stock: 0 }] };
    if (sql.includes("FROM bms_inventory_lots l")) return { rows: [] };
    if (sql.includes("FROM bms_product_stock_policies")) return { rows: [{ requires_lots: true }] };
    if (sql.includes("AS day")) return { rows: [{ day: "2026-11-13" }] };
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const stock = await qualityStock(client as any, "tenant", "branch", "SKU", "BASE");
  assert.equal(stock.reconciled, false);
  assert.equal(stock.available, 0);
  assert.match(usableStockSql("i"), /policy\.lot_tracking OR policy\.expiry_tracking/);
});

test("shipping a legacy tracked order without lot rows fails before a movement", async () => {
  const client = { query: async (sql: string) => {
    if (sql.includes("FROM bms_order_stock_lines")) return { rows: [{
      id: "line", location_id: "branch", product_sku: "SKU", size: "BASE", qty: 1,
    }] };
    if (sql.includes("FROM bms_inventory_lots l")) return { rows: [] };
    if (sql.includes("FROM bms_product_stock_policies")) return { rows: [{ requires_lots: true }] };
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  await assert.rejects(consumeOrderLotsInTx(client as any, "tenant", "order"), /INSUFFICIENT_USABLE_LOTS/);
});
