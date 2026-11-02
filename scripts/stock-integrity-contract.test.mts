import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
function load(name: string, deps: Record<string, any>) {
  const code = ts.transpileModule(readFileSync(new URL(`../apps/web/lib/bms/${name}.ts`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} as any };
  new Function("require", "module", "exports", code)((key: string) =>
    deps[key] ?? (key.startsWith(".") || key.startsWith("@") ? {} : require(key)), module, module.exports);
  return module.exports;
}
const rows = (data: any[] = []) => ({ rows: data, rowCount: data.length });
const quality = { assertNoQualityHold: async () => {}, LotQualityHoldError: class extends Error {} };

test("aggregate adjustment and count refuse actual lots even with tracking flags off", async () => {
  for (const count of [false, true]) {
    const calls: string[] = [];
    let released = false;
    const client = { release: () => { released = true; }, query: async (sql: string, params: any[]) => {
      calls.push(sql);
      if (sql === "ROLLBACK") return rows();
      if (sql.includes("FROM bms_stock_counts")) return rows([{ status: "DRAFT", location_id: "branch" }]);
      if (sql.includes("FROM bms_stock_count_items")) return rows([{ product_sku: "SKU", size: "BASE", snapshot_qty: 5, counted_qty: 6, stock_policy: "DIRECT" }]);
      if (sql.includes("FROM bms_products")) return rows([{}]);
      if (sql.includes("FROM bms_locations")) return rows([{ id: "branch" }]);
      if (sql.includes("FROM bms_inventory_lots")) {
        assert.deepEqual(params, ["tenant", "branch", "SKU", "BASE"]);
        return rows([{}]);
      }
      if (sql.includes("FROM bms_inventory")) return rows([{ current_stock: 5, reserved_stock: 0 }]);
      throw new Error(`Unexpected stock write: ${sql}`);
    } };
    const service = load(count ? "stockCounts" : "products", {
      "@/lib/db": { getClient: async () => client }, "./tenant": { beginTenantTx: async () => {} },
      "./lotQuality": quality,
      "./inventoryIdempotency": { inventoryIdempotency: () => null, replayInventoryResult: async () => null },
    });
    if (count) assert.equal((await service.applyStockCount({ tenantId: "tenant", countId: "count", actorUserId: "actor" })).status, "INVALID");
    else await assert.rejects(service.adjustStock("tenant", "SKU", "BASE", 1, null, "actor", "actor", "branch"), /ล็อต/);
    assert.equal(calls.at(-1), "ROLLBACK");
    assert.equal(released, true);
  }
});

test("wastage refuses unreconciled lots before changing stock", async () => {
  const service = load("wastage", {
    "./storeCapabilities": { isCapabilityEnabledInTx: async () => true },
    "./lotQuality": { qualityStock: async () => ({ reconciled: false }) },
  });
  await assert.rejects(service.recordInventoryWastageInTx({ query: () => assert.fail("must not write") }, {
    tenantId: "tenant", locationId: "branch", productSku: "SKU", size: "BASE", qty: 1, reason: "damage", actorUserId: "actor",
  }), /ยอดล็อต/);
});

test("PO receipt rolls back a tracked destination receiving units without lot identity", async () => {
  const calls: string[] = [];
  const client = { release() {}, query: async (sql: string) => {
    calls.push(sql);
    if (sql === "ROLLBACK") return rows();
    if (sql.includes("FROM bms_locations")) return rows([{ id: "branch" }]);
    if (sql.includes("FROM bms_purchase_orders")) return rows([{ status: "OPEN" }]);
    if (sql.includes("FROM bms_purchase_order_items")) return rows([{ id: "line", qty_ordered: 5, qty_received: 0, unit_cost: "10", additional_unit_cost: "0" }]);
    if (sql.includes("INSERT INTO bms_inventory")) return rows();
    if (sql.includes("FROM bms_inventory_lots")) return rows([{ lot_no: "A", expiry_date: null, qty: 5 }]);
    if (sql.includes("FROM bms_inventory")) return rows([{ current_stock: 6 }]);
    throw new Error(`Unexpected SQL after invalid receipt: ${sql}`);
  } };
  const service = load("purchase", {
    "@/lib/db": { getClient: async () => client }, "./tenant": { beginTenantTx: async () => {} },
    "./lots": load("lots", {}),
  });
  const result = await service.receivePurchaseOrder("tenant", "po", [{ sku: "SKU", size: "BASE", qty: 1 }], "actor", "actor", { locationId: "branch" });
  assert.equal(result.status, "INVALID_INPUT");
  assert.equal(calls.at(-1), "ROLLBACK");
  assert.ok(!calls.includes("COMMIT"));
});

for (const scenario of ["lot policy", "expiry policy", "existing lots", "empty historical lot", "plain stock"]) {
  test(`no-receipt return preserves stock and cash: ${scenario}`, async () => {
    let state = { stock: 5, writes: [] as string[] }, backup: typeof state;
    const calls: string[] = [];
    let released = false;
    const client = { release() { released = true; }, async query(sql: string, params: any[] = []) {
      calls.push(sql);
      if (sql === "BEGIN") { backup = structuredClone(state); return rows(); }
      if (sql === "ROLLBACK") { state = backup; return rows(); }
      if (sql === "COMMIT") return rows();
      if (sql.includes("FROM bms_pos_shifts")) return rows([{ id: "shift", status: "OPEN", location_id: "branch", opening_float: "1000" }]);
      if (sql.includes("FROM bms_pos_blind_returns")) return rows();
      if (sql.includes("FROM bms_product_stock_policies")) {
        assert.deepEqual(params, ["tenant", "SKU"]);
        return rows([{ lot_tracking: scenario === "lot policy", expiry_tracking: scenario === "expiry policy" }]);
      }
      if (sql.includes("FROM bms_inventory_lots")) {
        assert.deepEqual(params, ["tenant", "branch", "SKU", "BASE"]);
        return rows(scenario.includes("lot") ? [{ lot_no: "A", expiry_date: null, qty: scenario === "existing lots" ? 5 : 0 }] : []);
      }
      if (sql.includes("FROM bms_inventory")) return rows([{ current_stock: state.stock }]);
      if (sql.includes("INSERT INTO bms_inventory")) { state.stock += params[4]; state.writes.push(sql); return rows(); }
      if (/INSERT INTO bms_(pos_blind_returns|pos_blind_return_items|pos_cash_movements|audit_log)/.test(sql)) {
        state.writes.push(sql); return rows([{ id: "return" }]);
      }
      throw new Error(`Unexpected blind-return SQL: ${sql}`);
    } };
    const source = readFileSync(new URL("../apps/web/lib/bms/pos.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const start = source.indexOf("export async function blindReturnPosSale(");
    const body = source.slice(start, source.indexOf("\n}\n", start) + 3);
    const deps = {
      getClient: async () => client, beginTenantTx: async () => client.query("BEGIN"),
      getVariantBasePriceInTx: async () => 10, drawerExpectedInTx: async () => 1000,
      validateTransferLotReceiptInTx: load("lots", {}).validateTransferLotReceiptInTx,
      recordMovement: async () => { state.writes.push("MOVEMENT"); },
    };
    const service: any = {};
    new Function("exports", ...Object.keys(deps), ts.transpileModule(body, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText)(service, ...Object.values(deps));
    const result = await service.blindReturnPosSale({ tenantId: "tenant", deviceId: "device", shiftId: "shift",
      actorUserId: "cashier", approvedByUserId: "manager", reason: "return", idempotencyKey: "stable-key",
      lines: [{ sku: "SKU", size: "BASE", qty: 2, unitRefund: 10 }] });
    if (scenario === "plain stock") {
      assert.equal(result.status, "RETURNED"); assert.equal(state.stock, 7);
      assert.ok(state.writes.some(sql => sql.includes("pos_cash_movements")));
      assert.equal(calls.at(-1), "COMMIT");
    } else {
      assert.equal(result.status, "INVALID"); assert.ok(result.reason);
      assert.deepEqual(state, { stock: 5, writes: [] }); assert.equal(calls.at(-1), "ROLLBACK");
    }
    assert.equal(released, true);
  });
}
