import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "../apps/web/node_modules/typescript/lib/typescript.js";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

async function loadLotsModule() {
  const source = await read("apps/web/lib/bms/lots.ts");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exported: any = {};
  new Function("require", "exports", code)((name: string) => {
    if (name === "@/lib/db") return { query: async () => ({ rows: [] }) };
    if (name === "./lotQuality") {
      return {
        usableLotSql: () => "true",
        inheritQualityHold: async () => undefined,
      };
    }
    return {};
  }, exported);
  return exported;
}

test("transfer lots allocate FEFO without consuming the reserved remainder", async () => {
  const lots = await loadLotsModule();
  const updates: unknown[][] = [];
  const client = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes("FROM bms_inventory_lots l")) {
        return {
          rowCount: 2,
          rows: [
            { id: "lot-a", lot_no: "A", expiry_date: "2027-01-01", unit_cost: "4.25", supplier_id: "s1", qty: 3, transferable: true },
            { id: "lot-b", lot_no: "B", expiry_date: "2027-02-01", unit_cost: null, supplier_id: null, qty: 4, transferable: true },
          ],
        };
      }
      if (sql.includes("UPDATE bms_inventory_lots")) {
        updates.push(params);
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const result = await lots.allocateLotsForTransferInTx(client, {
    tenantId: "tenant", locationId: "source", productSku: "SKU", size: "BASE",
    qty: 4, currentStock: 7, reservedStock: 2,
  });
  assert.deepEqual(result, {
    status: "ALLOCATED",
    allocations: [
      { lotId: "lot-a", lotNo: "A", expiryDate: "2027-01-01", unitCost: 4.25, supplierId: "s1", qty: 3 },
      { lotId: "lot-b", lotNo: "B", expiryDate: "2027-02-01", unitCost: null, supplierId: null, qty: 1 },
    ],
  });
  assert.deepEqual(updates.map((params) => params[2]), [3, 1]);
});

test("transfer lots fail before writes when lot and summary totals disagree", async () => {
  const lots = await loadLotsModule();
  let writes = 0;
  const result = await lots.allocateLotsForTransferInTx({
    query: async (sql: string) => {
      if (/^\s*UPDATE\b/.test(sql)) writes += 1;
      return { rowCount: 1, rows: [{ id: "lot-a", qty: 3, transferable: true }] };
    },
  }, {
    tenantId: "tenant", locationId: "source", productSku: "SKU", size: "BASE",
    qty: 1, currentStock: 4, reservedStock: 0,
  });
  assert.deepEqual(result, { status: "UNRECONCILED", lotTotal: 3, stock: 4 });
  assert.equal(writes, 0);
});

test("partial receipt assigns good then damaged quantities in sent FEFO order", async () => {
  const lots = await loadLotsModule();
  assert.deepEqual(
    lots.splitTransferReceiptAcrossLots([{ qty: 3 }, { qty: 4 }], 4, 2),
    [
      { received: 3, damaged: 0, missing: 0 },
      { received: 1, damaged: 2, missing: 1 },
    ],
  );
  assert.throws(
    () => lots.splitTransferReceiptAcrossLots([{ qty: 2 }], 2, 1),
    /INVALID_TRANSFER_LOT_RECEIPT/,
  );
});

test("10.107 migration tenant-scopes transfer lot provenance and grants the app role", async () => {
  const migration = await read("db/migrations/10.107__bms_stock_transfer_lots.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS bms_stock_transfer_item_lots/);
  assert.match(migration, /FOREIGN KEY \(tenant_id, transfer_item_id\)/);
  assert.match(migration, /FOREIGN KEY \(tenant_id, source_lot_id\)/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /CREATE POLICY bms_stock_transfer_item_lots_tenant_isolation/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON bms_stock_transfer_item_lots TO bms_app/);
  assert.match(migration, /GRANT USAGE, SELECT ON SEQUENCE bms_stock_transfer_item_lots_id_seq TO bms_app/);
});

test("receipt preserves destination lot reconciliation and refuses conflicting expiry", async () => {
  const lots = await loadLotsModule();
  const incoming = [{ lot_no: "A", expiry_date: "2027-01-01", qty: 3 }];
  const check = async (stock: number, existing: unknown[], sent = incoming) => {
    const client = { query: async (sql: string, params: unknown[]) => {
      assert.deepEqual(params, ["tenant", "destination", "SKU", "BASE"]);
      assert.match(sql, /FOR UPDATE/);
      return { rows: sql.includes("FROM bms_inventory_lots") ? existing : [{ current_stock: stock }] };
    } };
    return lots.validateTransferLotReceiptInTx(client, {
      tenantId: "tenant", locationId: "destination", productSku: "SKU", size: "BASE",
      receivedQty: 3, lots: sent,
    });
  };
  assert.equal(await check(3, []), null, "first tracked receipt into an empty branch");
  assert.ok(await check(8, []), "cannot invent lot identity for five old untracked units");
  assert.equal(await check(8, [{ ...incoming[0], qty: 5 }]), null);
  assert.ok(await check(8, [{ ...incoming[0], qty: 4 }]), "pre-existing mismatch");
  assert.ok(await check(8, [{ ...incoming[0], qty: 5 }], []), "untracked units cannot enter tracked stock");
  assert.equal(await check(8, [], []), null, "ordinary untracked receipt remains supported");
  assert.ok(await check(8, [{ ...incoming[0], qty: 5, expiry_date: "2028-01-01" }]));
  assert.ok(await check(8, [{ ...incoming[0], qty: 5, expiry_date: null }]));
});

test("allocation excludes expired and held lots and reserves usable stock before any write", async () => {
  const lots = await loadLotsModule();
  const result = await lots.allocateLotsForTransferInTx({ query: async (sql: string) => {
    assert.doesNotMatch(sql, /^\s*UPDATE/);
    return { rowCount: 3, rows: [
      { qty: 4, transferable: false }, { qty: 3, transferable: false },
      { qty: 3, transferable: true },
    ] };
  } }, { tenantId: "tenant", locationId: "source", productSku: "SKU", size: "BASE",
    qty: 2, currentStock: 10, reservedStock: 2 });
  assert.deepEqual(result, { status: "INSUFFICIENT", available: 1 });
});

test("receipt rejects fractional quantities and rolls back destination conflicts without movements", async () => {
  const code = ts.transpileModule(await read("apps/web/lib/bms/stockTransfers.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const qty of [-1, 1.5, 2]) {
    const statements: string[] = [];
    let released = false;
    const client = { release: () => { released = true; }, query: async (sql: string) => {
      statements.push(sql);
      if (sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("FROM bms_stock_transfers")) return { rowCount: 1, rows: [{ status: "IN_TRANSIT", to_location: "dest" }] };
      if (sql.includes("FROM bms_stock_transfer_items")) return { rows: [{ id: 1, product_sku: "SKU", size: "BASE", qty: 2 }] };
      if (sql.includes("FROM bms_inventory")) return { rows: [] };
      if (sql.includes("INSERT INTO bms_inventory")) return { rows: [] };
      if (sql.includes("FROM bms_stock_transfer_item_lots")) return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected SQL ${sql}`);
    } };
    const service: any = {};
    new Function("require", "exports", code)((name: string) => {
      if (name === "@/lib/db") return { getClient: async () => client };
      if (name === "./tenant") return { beginTenantTx: async () => {} };
      if (name === "./inventoryIdempotency") return { inventoryIdempotency: () => null, replayInventoryResult: async () => null };
      if (name === "./lotQuality") return { assertNoQualityHold: async () => {}, LotQualityHoldError: class extends Error {} };
      if (name === "./lots") return { validateTransferLotReceiptInTx: async () => "destination conflict" };
      if (name === "./movements") return { recordMovement: () => assert.fail("rejected receipt must not record movement") };
      return {};
    }, service);
    const result = await service.receiveStockTransfer({ tenantId: "tenant", transferId: "transfer", actorUserId: "actor",
      received: [{ itemId: 1, qty }] });
    assert.equal(result.status, "INVALID");
    assert.equal(statements.at(-1), "ROLLBACK");
    assert.equal(statements.some((sql) => sql.includes("INSERT INTO bms_inventory")), qty === 2);
    assert.equal(released, true);
  }
});

test("a hold placed on an empty source lot after SEND blocks receipt and rolls back destination stock", async () => {
  const compile = async (path: string) => ts.transpileModule(await read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const quality: any = {};
  new Function("require", "exports", await compile("apps/web/lib/bms/lotQuality.ts"))(() => ({}), quality);
  const statements: string[] = [];
  let destinationDelta = 0;
  let released = false;
  const client = { release: () => { released = true; }, query: async (sql: string, params: any[] = []) => {
    statements.push(sql);
    if (sql === "ROLLBACK") { destinationDelta = 0; return { rows: [] }; }
    if (sql.includes("FROM bms_stock_transfers")) return { rowCount: 1, rows: [{ status: "IN_TRANSIT", from_location: "source", to_location: "dest" }] };
    if (sql.includes("FROM bms_stock_transfer_items")) return { rows: [{ id: 1, product_sku: "SKU", size: "BASE", qty: 2 }] };
    if (sql.includes("FROM bms_stock_transfer_item_lots")) return { rowCount: 1, rows: [{ qty: 2, source_lot_id: "source-lot" }] };
    if (sql.includes("AS day")) return { rows: [{ day: "2026-11-02" }] };
    if (sql.includes("FROM bms_product_stock_policies")) return { rows: [{ requires_lots: false }] };
    if (sql.includes("FROM bms_inventory_lots")) {
      assert.match(sql, /FOR UPDATE OF l/);
      assert.equal(params[0], "tenant");
      return { rows: params[1] === "source" ? [{ id: "source-lot", qty: 0, expiry_date: null, usable: false }] : [] };
    }
    if (sql.includes("FROM bms_inventory")) {
      assert.match(sql, /FOR UPDATE/);
      return { rows: [{ current_stock: 0, reserved_stock: 0 }] };
    }
    if (sql.includes("INSERT INTO bms_inventory")) { destinationDelta += 2; return { rows: [] }; }
    throw new Error(`Unexpected SQL after source hold: ${sql}`);
  } };
  const service: any = {};
  new Function("require", "exports", await compile("apps/web/lib/bms/stockTransfers.ts"))((name: string) => {
    if (name === "@/lib/db") return { getClient: async () => client };
    if (name === "./tenant") return { beginTenantTx: async () => {} };
    if (name === "./inventoryIdempotency") return { inventoryIdempotency: () => null, replayInventoryResult: async () => null };
    if (name === "./lotQuality") return quality;
    if (name === "./lots") return { receiveLotInTx: () => assert.fail("held stock cannot become a destination lot") };
    if (name === "./movements") return { recordMovement: () => assert.fail("held receipt must not record a movement") };
    return {};
  }, service);
  const result = await service.receiveStockTransfer({ tenantId: "tenant", transferId: "transfer", actorUserId: "actor" });
  assert.equal(result.status, "LOT_QUALITY_HOLD");
  assert.equal(destinationDelta, 0);
  assert.equal(statements.at(-1), "ROLLBACK");
  assert.ok(statements.some((sql) => sql.includes("INSERT INTO bms_inventory")));
  const lockIndex = statements.findIndex(sql => sql.includes("location_id=ANY($2::uuid[])"));
  assert.ok(lockIndex >= 0);
  assert.match(statements[lockIndex], /ORDER BY location_id FOR UPDATE/);
  assert.ok(lockIndex < statements.findIndex(sql => sql.includes("FROM bms_inventory_lots")));
  assert.ok(lockIndex < statements.findIndex(sql => sql.includes("INSERT INTO bms_inventory")));
  assert.equal(released, true);
});
