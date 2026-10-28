import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "../apps/web/node_modules/typescript/lib/typescript.js";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("lookup preserves base quantities, bounds pages, and reports unsupported identity stock", async () => {
  const source = await read("apps/web/lib/bms/stock.ts");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const rows = Array.from({ length: 51 }, (_, index) => ({
    sku: `SKU-${index}`, name: "Flour", size: "BASE", location_id: "branch-a",
    location_name: "A", current_stock: "1500", reserved_stock: "200",
    quarantine_stock: "50", available: "1300", incoming_stock: "400", reorder_point: "100",
    stock_policy: "DIRECT", base_unit: "GRAM", display_unit: "KG", display_precision: 3,
    lot_tracked: index === 1, expiry_tracked: false, serial_tracked: index === 2, is_bundle: false,
  }));
  const exported: any = {};
  new Function("require", "exports", code)((name: string) => {
    if (name === "@/lib/db") return { query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params }); return { rows };
    } };
    if (name === "./lotQuality") return { usableStockSql: () => "1300" };
    return {};
  }, exported);
  const result = await exported.searchBranchStock({ tenantId: "tenant-a", locationId: "branch-a", search: "  10%_  ", limit: 999, offset: 20 });
  assert.deepEqual(calls[0].params, ["tenant-a", "branch-a", "10%_", "10\\%\\_", 51, 20]);
  assert.equal(result.items.length, 50);
  assert.equal(result.nextOffset, 70);
  assert.equal(result.items[0].currentStock, 1500);
  assert.equal(result.items[0].available, 1300);
  assert.equal(result.items[0].baseUnit, "GRAM");
  assert.equal(result.items[0].transferSupported, true);
  assert.equal(result.items[1].transferSupported, false);
  assert.equal(result.items[2].countSupported, false);
  rows.length = 0;
  const empty = await exported.searchBranchStock({ tenantId: "tenant-a", locationId: "branch-a" });
  assert.deepEqual(empty, { items: [], nextOffset: null });
  assert.match(calls[0].sql, /FROM bms_product_variants variant/);
  assert.match(calls[0].sql, /LEFT JOIN bms_inventory balance/);
  assert.match(calls[0].sql, /pack.size IS NULL OR pack.size = i.size/);
});

test("lookup does not relabel base quantities or mistake a failed refresh for empty stock", async () => {
  const screen = await read("apps/mobile/src/screens/inventory/InventoryScreen.tsx");
  assert.match(screen, /const unit = item.baseUnit/);
  assert.match(screen, /!loading && !failed && items.length === 0/);
  assert.match(screen, /skip: !credentials \|\| mode !== 'LOOKUP',[\s\S]*?fetchPolicy: 'network-only'/);
  assert.match(screen, /lookupSearch === lookupDraft.trim\(\)[\s\S]*?refetchStockSearch\(\)/);
});

test("native stock lookup is bounded and derives its branch from the POS device", async () => {
  const [stock, graphql, operations] = await Promise.all([
    read("apps/web/lib/bms/stock.ts"),
    read("apps/web/graphql/bmsPosDevice.ts"),
    read("apps/mobile/src/graphql/operations.graphql"),
  ]);
  assert.match(stock, /export async function searchBranchStock/);
  assert.match(stock, /i\.tenant_id = \$1[\s\S]*i\.location_id = \$2/);
  assert.match(stock, /const limit = Math\.min\([\s\S]*?50,?\s*\)/);
  assert.match(stock, /LIMIT \$5 OFFSET \$6/);
  assert.match(
    graphql,
    /async bmsPosStockSearch[\s\S]*requirePosCashier\(device, args\.credentials, "product\.view"\)/
  );
  assert.match(graphql, /locationId: device\.locationId/);
  assert.match(
    operations,
    /query MobilePosStockSearch[\s\S]*\$limit: Int = 30[\s\S]*\$offset: Int = 0/
  );
});

test("stock lookup keeps sellable, reserved, quarantine, incoming, and operation support separate", async () => {
  const [stock, operations, screen] = await Promise.all([
    read("apps/web/lib/bms/stock.ts"),
    read("apps/mobile/src/graphql/operations.graphql"),
    read("apps/mobile/src/screens/inventory/InventoryScreen.tsx"),
  ]);
  for (const field of [
    "currentStock",
    "reservedStock",
    "quarantineStock",
    "available",
    "incomingStock",
    "operationBlockReason",
  ]) {
    assert.match(stock, new RegExp(field));
    assert.match(operations, new RegExp(field));
  }
  assert.match(screen, /ค้นด้วยชื่อ SKU หรือบาร์โค้ด/);
  assert.match(screen, /พร้อมใช้ \{item\.available\}/);
  assert.match(screen, /BarcodeScannerModal<StockScanResult>/);
  assert.match(
    screen,
    /label="เพิ่มลงใบโอน"[\s\S]*disabled=\{loading \|\| failed \|\| !item\.transferSupported\}/
  );
  assert.match(
    screen,
    /label="เพิ่มลงใบนับ"[\s\S]*disabled=\{loading \|\| failed \|\| !item\.countSupported\}/
  );
});

test("aggregate transfer and count fail closed for identity-tracked or derived stock", async () => {
  const [transfers, counts] = await Promise.all([
    read("apps/web/lib/bms/stockTransfers.ts"),
    read("apps/web/lib/bms/stockCounts.ts"),
  ]);
  for (const source of [transfers, counts]) {
    assert.match(source, /serial_tracked/);
    assert.match(source, /lot_tracking/);
    assert.match(source, /expiry_tracking/);
    assert.match(source, /"SERIALIZED", "BUNDLE", "RECIPE", "NON_STOCK"/);
  }
  assert.match(transfers, /ยังไม่รองรับการโอนแบบยอดรวม/);
  assert.match(counts, /ไม่รองรับการนับแบบยอดรวม/);
});

test("sending an older draft rejects unsupported stock before inventory writes and rolls back", async () => {
  const code = ts.transpileModule(await read("apps/web/lib/bms/stockTransfers.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const statements: string[] = [];
  let released = false;
  const client = {
    release: () => { released = true; },
    query: async (sql: string, params: unknown[]) => {
      statements.push(sql);
      if (sql.includes("FROM bms_stock_transfers")) return { rowCount: 1, rows: [{ id: "draft", status: "DRAFT", from_location: "source" }] };
      if (sql.includes("FROM bms_stock_transfer_items")) return { rows: [{ id: "line", product_sku: "LOT", size: "BASE", qty: 2 }] };
      if (sql.includes("FROM bms_products")) {
        assert.deepEqual(params, ["tenant-a", ["LOT"]]);
        return { rows: [{ sku: "LOT" }] };
      }
      if (sql === "ROLLBACK") return { rows: [] };
      throw new Error(`Unexpected write/read: ${sql}`);
    },
  };
  const exported: any = {};
  new Function("require", "exports", code)((name: string) => {
    if (name === "@/lib/db") return { getClient: async () => client };
    if (name === "./tenant") return { beginTenantTx: async () => undefined };
    if (name === "./inventoryIdempotency") return {
      inventoryIdempotency: () => null, replayInventoryResult: async () => null,
    };
    if (name === "./lotQuality") return { LotQualityHoldError: class extends Error {} };
    return {};
  }, exported);
  const result = await exported.sendStockTransfer({ tenantId: "tenant-a", transferId: "draft", actorUserId: "staff" });
  assert.equal(result.status, "INVALID");
  assert.match(result.reason, /LOT/);
  assert.equal(statements.at(-1), "ROLLBACK");
  assert.equal(statements.some(sql => /^\s*(UPDATE|INSERT|DELETE)\b/.test(sql)), false);
  assert.equal(released, true);
});
