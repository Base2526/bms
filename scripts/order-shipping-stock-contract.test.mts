import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../apps/web/lib/bms/orderShippingStock.ts", import.meta.url), "utf8");

function shippingStock(events: string[]) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: any = {};
  new Function("require", "exports", compiled)((id: string) => {
    if (id === "./orderLots") return { consumeOrderLotsInTx: async () => { events.push("lots"); } };
    if (id === "./movements") return { recordOrderMovements: async (_: unknown, ids: string[], kind: string, actor: string) => {
      assert.deepEqual(ids, ["order"]);
      assert.equal(kind, "SHIP");
      assert.equal(actor, "cashier");
      events.push("movement");
    } };
    throw new Error(`Unexpected dependency: ${id}`);
  }, exports);
  return exports.consumeReservedOrderStockInTx as Function;
}

test("shipping refuses an incomplete reservation before lot or movement writes", async () => {
  const events: string[] = [];
  const run = shippingStock(events);
  const client = { query: async (sql: string, params: unknown[]) => {
    assert.match(sql, /FROM bms_order_stock_lines/);
    assert.match(sql, /inv\.tenant_id = \$1/);
    assert.deepEqual(params, ["tenant", "order"]);
    events.push("stock");
    return { rows: [{ expected_count: "2", updated_count: "1" }] };
  } };
  await assert.rejects(run(client, "tenant", "order", "cashier"), /STOCK_REVIEW_REQUIRED/);
  assert.deepEqual(events, ["stock"]);
});

test("shipping records lot and movement after every reserved stock line was consumed", async () => {
  const events: string[] = [];
  const run = shippingStock(events);
  const client = { query: async () => { events.push("stock"); return { rows: [{ expected_count: "2", updated_count: "2" }] }; } };
  await run(client, "tenant", "order", "cashier");
  assert.deepEqual(events, ["stock", "lots", "movement"]);
});
