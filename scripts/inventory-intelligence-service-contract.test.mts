import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as quality from "../apps/web/lib/bms/forecastQuality.ts";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
function load(name: string, deps: Record<string, any>) {
  const source = readFileSync(new URL(`../apps/web/lib/bms/${name}.ts`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} as any };
  new Function("require", "module", "exports", code)((name: string) => {
    if (name === "crypto" || name === "node:crypto") return require(name);
    assert.ok(name in deps, `Unexpected dependency: ${name}`);
    return deps[name];
  }, module, module.exports);
  return module.exports;
}
const tenant = "11111111-1111-4111-8111-111111111111";
const row = (location: string, stock: number, sales = 30) => ({ location_id: location, location_name: location,
  sku: "TEST", name: "Test", size: "M", current_stock: stock, reserved_stock: 0, quarantine_stock: 0,
  usable_stock: stock, reorder_point: 5, sold_recent: sales, sold_previous: sales, confirmed_demand: 0,
  allocated_incoming: 0, safety_stock_days: 7, lead_time_days: 7, policy_source: "DEFAULT" });

function harness(items = [row("A", 0)], options: { cold?: string; fail?: boolean; expiring?: any[] } = {}) {
  const calls: Array<{ sql: string; params: any[] }> = [];
  let scoped = false, released = 0;
  const client = { release() { released++; }, async query(sql: string, params: any[] = []) {
    calls.push({ sql, params });
    const positions = [...new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))].sort((a,b) => a-b);
    assert.deepEqual(positions, Array.from({ length: params.length }, (_, i) => i+1), "SQL must bind contiguous parameters with no unused arguments");
    if (sql === "BEGIN") scoped = false;
    if (sql.includes("set_config('bms.tenant_id'")) { assert.equal(params[0], tenant); scoped = true; }
    const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
    if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL|SELECT set_config)/.test(sql)) return result();
    assert.ok(scoped, "business reads/writes require a tenant transaction");
    assert.equal(params[0], tenant);
    if (options.fail) throw new Error("database unavailable");
    if (sql.includes("paid_order_count")) return result([...new Set(items.map((i) => i.location_id))]
      .filter((id) => id !== options.cold).map((location_id) => ({ location_id, paid_order_count: 10, active_sales_days: 5 })));
    if (sql.includes("WITH sales AS")) return result(items);
    if (sql.includes("days_to_expiry")) return result(options.expiring ?? []);
    if (sql.includes("INSERT INTO bms_inventory_forecast_runs")) return result([{ id: "run" }]);
    if (sql.includes("sample_count")) return result([{ sample_count: 0, mae: 0, bias: 0, wape: null }]);
    return result();
  } };
  const db = { getClient: async () => client, query: async () => { throw new Error("Unscoped pool query"); } };
  const tenantModule = load("tenant", {});
  const evidence = load("inventoryEvidenceRead", { "@/lib/db": db, "./tenant": tenantModule });
  const lot = load("lotQuality", { "./operationQualityDispatch": {} });
  const deps = { "@/lib/db": db, "./tenant": tenantModule, "./forecastQuality": quality, "./lotQuality": lot, "./inventoryEvidenceRead": evidence };
  return { service: load("inventoryIntelligence", deps), anomalies: load("inventoryAnomalies", deps),
    suppliers: load("supplierIntelligence", deps), calls, released: () => released };
}

test("all inventory evidence SQL uses contiguous parameters and tenant-scoped connections", async () => {
  const h = harness();
  await h.service.getInventoryIntelligence({ tenantId: tenant });
  await h.service.getInventoryForecastAccuracy({ tenantId: tenant });
  await h.anomalies.getInventoryAnomalies({ tenantId: tenant });
  await h.suppliers.getSupplierIntelligence({ tenantId: tenant });
  assert.equal(h.released(), 4);
  assert.equal(h.calls.filter((c) => c.sql === "COMMIT").length, 4);
});

test("database failure rolls back and releases the evidence connection", async () => {
  const h = harness([], { fail: true });
  await assert.rejects(h.service.getInventoryIntelligence({ tenantId: tenant }), /database unavailable/);
  assert.equal(h.released(), 1);
  assert.equal(h.calls.at(-1)?.sql, "ROLLBACK");
  assert.ok(!h.calls.some((c) => c.sql === "COMMIT"));
});

test("branch denial happens before database access and scoped reads exclude unallocated evidence", async () => {
  const h = harness();
  await assert.rejects(h.service.getInventoryIntelligence({ tenantId: tenant, locationId: "B", allowedLocationIds: ["A"] }));
  assert.equal(h.calls.length, 0);
  await h.service.getInventoryIntelligence({ tenantId: tenant, allowedLocationIds: ["A"] });
  assert.ok(!h.calls.some((c) => c.sql.includes("bms_restock_subscriptions")));
});

test("a cold branch cannot borrow another branch's history to recommend purchasing", async () => {
  const h = harness([row("A", 0), row("B", 0)], { cold: "B" });
  const result = await h.service.getInventoryIntelligence({ tenantId: tenant });
  assert.equal(result.items[0].suggestedQty, 44);
  assert.equal(result.items[1].suggestedQty, 0);
  assert.equal(result.items[1].classification, "INSUFFICIENT_DATA");
});

test("transfer suggestions conserve donor surplus across multiple receivers and keep lead-time stock", async () => {
  const h = harness([row("A", 0), row("B", 0), row("D", 94)]);
  const result = await h.service.findInventoryTransferOpportunities({ tenantId: tenant });
  assert.deepEqual(result.items.map((i: any) => i.qty), [44, 6]);
  assert.equal(result.items.reduce((sum: number, i: any) => sum+i.qty, 0), 50);
  assert.equal(result.items[1].donorSurplus, 6);
});

test("a branch needing replenishment cannot donate even when incoming POs hide its shortage", async () => {
  const donor = { ...row("D", 20), allocated_incoming: 100 };
  const h = harness([row("A", 0), donor]);
  assert.equal((await h.service.findInventoryTransferOpportunities({ tenantId: tenant })).items.length, 0);
});

test("transfer search sees donors beyond the first hundred rows", async () => {
  const items = [row("A", 0), ...Array.from({ length: 100 }, (_, i) => ({ ...row(`X${i}`, 0), sku: `OTHER${i}` })), row("D", 54)];
  const h = harness(items);
  const result = await h.service.findInventoryTransferOpportunities({ tenantId: tenant });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].qty, 10);
});

test("clamped transfer limits accurately disclose truncation", async () => {
  const h = harness([...Array.from({ length: 60 }, (_, i) => row(`R${i}`, 0)), row("D", 5000)]);
  const result = await h.service.findInventoryTransferOpportunities({ tenantId: tenant, limit: 500 });
  assert.equal(result.items.length, 50);
  assert.equal(result.totalCount, 60);
  assert.equal(result.truncated, true);
});

test("snapshots use paid consumption only, skip cold branches and leave uncalibrated bounds unknown", async () => {
  const h = harness([{ ...row("A", 100), confirmed_demand: 30 }, row("B", 0)], { cold: "B" });
  const result = await h.service.recordInventoryForecastSnapshot({ tenantId: tenant, horizonDays: 30 });
  assert.equal(result.itemCount, 1);
  const insert = h.calls.find((c) => c.sql.includes("INSERT INTO bms_inventory_forecast_items"))!;
  assert.equal(insert.params[6], 30);
  assert.deepEqual(insert.params.slice(7), [null, null]);
});

test("evaluation uses exactly the recorded horizon and accuracy excludes old method versions", async () => {
  const h = harness();
  await h.service.evaluateDueInventoryForecasts(tenant);
  await h.service.getInventoryForecastAccuracy({ tenantId: tenant });
  const evaluation = h.calls.find((c) => c.sql.includes("WITH due"))!;
  assert.equal((evaluation.sql.match(/fr.generated_at\+make_interval\(days=>fr.horizon_days\)/g) ?? []).length, 2);
  assert.doesNotMatch(evaluation.sql, /fi.target_date\+1/);
  assert.match(evaluation.sql, /FOR UPDATE OF fi SKIP LOCKED/);
  const accuracy = h.calls.find((c) => c.sql.includes("sample_count"))!;
  assert.equal(accuracy.params[4], "2.1");
});

test("expiry today stays eligible for FEFO review, matching the shared usable-stock rule", async () => {
  const h = harness([], { expiring: [{ location_id: "A", location_name: "A", sku: "TEST", size: "M", name: "Test",
    lot_no: "L1", expiry_date: "2026-10-28", qty: 5, days_to_expiry: 0 }] });
  const result = await h.service.getInventoryIntelligence({ tenantId: tenant });
  assert.equal(result.expiringLots[0].recommendedAction, "FEFO_MARKDOWN_OR_TRANSFER");
});
