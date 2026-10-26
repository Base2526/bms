import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as events from "../packages/realtime/src/events.ts";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
// Execute service code; substitute transport and unrelated collaborators only.
function load(name: string, deps: Record<string, any> = {}) {
  const compiled = ts.transpileModule(read(`apps/web/lib/bms/${name}.ts`), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} as any };
  new Function("require", "module", "exports", compiled)(
    (key: string) => key in deps ? deps[key] : key.startsWith(".") || key.startsWith("@") ? {} : require(key),
    module, module.exports,
  );
  return module.exports;
}
const rows = (items: any[] = []) => ({ rows: items, rowCount: items.length });
const quality = load("lotQuality");

test("POS scan and variant choices use usable stock with server-derived branch scope", async () => {
  for (const usable of [0, 3, 10]) {
    const db = { query: async (sql: string, params: unknown[]) => {
      if (sql.includes("WITH product")) {
        assert.ok(sql.includes(quality.usableStockSql("inventory")));
        assert.deepEqual(params, ["tenant", "sku", "branch"]);
        return rows([{ size: "BASE", available: String(usable), price: "25", stock_tracked: true }]);
      }
      assert.ok(sql.includes(quality.usableStockSql("i")));
      assert.deepEqual(params, ["tenant", "branch", "sku", "BASE"]);
      return rows([{ available: String(usable) }]);
    } };
    const pos = load("pos", { "@/lib/db": db, "./lotQuality": quality,
      "./branchPrices": { readBranchPrice: async () => null } });
    assert.equal(await pos.getPosVariantAvailable("tenant", "branch", "sku", "BASE"), usable);
    assert.deepEqual(await pos.listPosVariantChoices("tenant", "sku", "branch"), [
      { size: "BASE", available: usable, price: 25, stockTracked: true },
    ]);
  }
});

test("restaurant direct-stock menu excludes held lots without hiding virtual recipe/non-stock products", async () => {
  const menuPolicy = load("menuAvailability");
  for (const usable of [0, 3]) {
    const restaurant = load("restaurantPos", {
      "./lotQuality": quality, "./menuAvailability": menuPolicy,
      "./productPacks": { getVariantBasePrice: async () => 25 },
      "./products": { listPrimaryProductImages: async () => new Map() },
      "./kitchenStations": { kitchenStationColumnsSql: () => ({ id: "st.id", name: "st.name" }) },
      "@/lib/db": { query: async (sql: string, params: unknown[]) => {
        if (sql.includes("SELECT business_archetype")) return rows([{ business_archetype: "restaurant" }]);
        assert.equal(sql.split(quality.usableStockSql("i")).length - 1, 2);
        assert.deepEqual(params, ["tenant", "branch"]);
        return rows(["DIRECT", "RECIPE", "NON_STOCK"].map(stock_policy => ({
          sku: stock_policy, name: stock_policy, price: "25", stock_policy,
          available_total: String(stock_policy === "DIRECT" ? usable : 0),
          sizes: [{ size: "BASE", available: stock_policy === "DIRECT" ? usable : 0 }],
        })));
      } },
    });
    const result = await restaurant.listRestaurantMenu("tenant", "branch");
    assert.equal(result[0].sellable, usable > 0);
    assert.equal(result[0].availableSizes[0].available, usable);
    assert.equal(result[1].sellable, true);
    assert.equal(result[2].sellable, true);
  }
});

test("native branch overview counts only usable stock and keeps query scope and bounds", async () => {
  const stock = load("stock", { "./lotQuality": quality, "@/lib/db": { query: async (sql: string, params: unknown[]) => {
    assert.ok(sql.includes(quality.usableStockSql("i")));
    assert.doesNotMatch(sql, /\(i.current_stock - i.reserved_stock\)/);
    assert.deepEqual(params.slice(0, 2), ["tenant", "branch"]);
    if (sql.includes("AS sellable_sku_count")) return rows([{ sellable_sku_count: 0, low_stock_count: 1 }]);
    assert.equal(params[2], 50);
    return rows([{ sku: "sku", name: "Held", size: "BASE", available: 0, reorder_point: 2 }]);
  } } });
  assert.deepEqual(await stock.getBranchStockOverview("tenant", "branch", 999), {
    sellableSkuCount: 0, lowStockCount: 1,
    lowStock: [{ sku: "sku", name: "Held", size: "BASE", available: 0, reorderPoint: 2 }],
  });
});

for (const action of ["sendStockTransfer", "receiveStockTransfer", "applyStockCount"] as const) {
  test(`${action} returns a decided quality rejection and rolls back earlier lines, but preserves unexpected faults`, async () => {
    for (const fault of [false, true]) {
      const calls: string[] = [];
      let changed = 0, movements = 0, released = false;
      const client = { release() { released = true; }, query: async (sql: string, params?: unknown[]) => {
        calls.push(sql);
        if (sql === "ROLLBACK") { changed = 0; movements = 0; return rows(); }
        assert.equal(params?.[0], "tenant");
        if (sql.includes("FROM bms_stock_transfers")) return rows([{ status: action === "sendStockTransfer" ? "DRAFT" : "IN_TRANSIT", from_location: "source", to_location: "destination", transfer_no: "T" }]);
        if (sql.includes("FROM bms_stock_counts")) return rows([{ status: "DRAFT", location_id: "source", count_no: "C" }]);
        if (sql.includes("FROM bms_stock_transfer_items") || sql.includes("FROM bms_stock_count_items")) return rows(["healthy", "held"].map((product_sku, id) => ({ id, product_sku, size: "BASE", qty: 1, snapshot_qty: 10, counted_qty: 9 })));
        if (sql.includes("AS day")) return rows([{ day: "2026-10-26" }]);
        if (sql.includes("FROM bms_inventory_lots")) return rows([{ qty: 10, expiry_date: null, usable: params?.[2] !== "held" }]);
        if (sql.includes("FROM bms_inventory")) {
          if (fault && params?.[2] === "held") throw new Error("database unavailable");
          return rows([{ current_stock: 10, reserved_stock: 0 }]);
        }
        if (sql.includes("UPDATE bms_inventory") || sql.includes("INSERT INTO bms_inventory")) { changed++; return rows(); }
        if (sql.includes("UPDATE bms_stock_transfer_items")) return rows();
        throw new Error(`Unexpected SQL: ${sql}`);
      } };
      const originalQuery = client.query;
      client.query = async (sql: string, params?: unknown[]) => sql.includes("AS day") ? rows([{ day: "2026-10-26" }]) : originalQuery(sql, params);
      const service = load(action === "applyStockCount" ? "stockCounts" : "stockTransfers", {
        "./lotQuality": quality,
        "@/lib/db": { getClient: async () => client }, "./tenant": { beginTenantTx: async () => {} },
        "./inventoryIdempotency": { inventoryIdempotency: () => null, replayInventoryResult: async () => null, storeInventoryResult: async () => assert.fail("must not save a successful result") },
        "./movements": { recordMovement: async () => { movements++; } },
      });
      const run = () => service[action]({ tenantId: "tenant", transferId: "transfer", countId: "count", actorUserId: "actor" });
      if (fault) await assert.rejects(run, /database unavailable/);
      else {
        const result = await run();
        assert.equal(result.status, "LOT_QUALITY_HOLD");
        assert.equal(result.sku, "held");
        assert.match(result.reason, /quality hold/);
      }
      assert.ok(calls.some(sql => /(?:UPDATE|INSERT INTO) bms_inventory/.test(sql)), "exercise rollback after an earlier line wrote stock");
      assert.ok(calls.includes("ROLLBACK"));
      assert.ok(!calls.includes("COMMIT"));
      assert.equal(changed, 0);
      assert.equal(movements, 0);
      assert.equal(released, true);
    }
  });
}

test("quality availability invalidation uses the tenant transaction and existing branch-scoped event", async () => {
  const tenant = "11111111-1111-4111-8111-111111111111";
  const branch = "22222222-2222-4222-8222-222222222222";
  const actor = "33333333-3333-4333-8333-333333333333";
  const lot = { id: "44444444-4444-4444-8444-444444444444", location_id: branch };
  const outbox = load("realtimeOutbox", { "../../../../packages/realtime/src/events": events });
  const dispatch = load("operationQualityDispatch", { "./realtimeOutbox": outbox });
  for (const change of ["HOLD", "RELEASE"]) {
    let inserted = false;
    const c = { query: async (sql: string, params: unknown[]) => {
      assert.match(sql, /INSERT INTO bms_realtime_outbox/);
      assert.deepEqual(params.slice(1, 3), [tenant, branch]);
      assert.equal(params[7], "inventory.changed");
      assert.deepEqual(JSON.parse(params[13] as string), { change, source: "operations.quality" });
      inserted = true;
      return rows([{ id: 1, event_id: params[0] }]);
    } };
    await dispatch.notifyLotAvailabilityInTx(c, tenant, actor, lot, change);
    assert.equal(inserted, true);
    await assert.rejects(() => dispatch.notifyLotAvailabilityInTx({ query: async () => { throw new Error("outbox failed"); } }, tenant, actor, lot, change), /outbox failed/);
  }
  const command = read("apps/web/lib/bms/operationQuality.ts");
  assert.match(command, /notifyLotAvailabilityInTx\(c, s.tenantId, s.actorId, l, "HOLD"\)/);
  assert.match(command, /notifyLotAvailabilityInTx\(c, s.tenantId, s.actorId, l, "RELEASE"\)/);
});

test("existing native operations remain valid against the operations-release GraphQL schema", () => {
  const { buildSchema, parse, validate } = require(fileURLToPath(new URL("../apps/web/node_modules/graphql/index.js", import.meta.url)));
  const schema = buildSchema(read("schema.graphql"));
  assert.deepEqual(validate(schema, parse(read("apps/mobile/src/graphql/operations.graphql"))), []);
});
