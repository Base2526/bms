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

for (const policy of ["lot_tracking", "expiry_tracking"]) {
  test(`manual adjustment cannot bypass ${policy} before the first lot exists`, async () => {
    const calls: string[] = [];
    const client = { release() {}, query: async (sql: string) => {
      calls.push(sql);
      if (sql === "ROLLBACK") return rows();
      if (sql.includes("FROM bms_products")) return rows([{ [policy]: true }]);
      throw new Error(`Unexpected SQL after tracked adjustment: ${sql}`);
    } };
    const service = load("products", { "@/lib/db": { getClient: async () => client },
      "./tenant": { beginTenantTx: async () => {} } });
    await assert.rejects(service.adjustStock("tenant", "SKU", "BASE", 1, null, "actor", "actor", "branch"), /ล็อต/);
    assert.equal(calls.at(-1), "ROLLBACK");
  });
}

test("expiry excludes owned reservations, rechecks late deposits and scopes each tenant transaction", async () => {
  const source = readFileSync(new URL("../apps/web/lib/bms/orders.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("export async function releaseExpiredOrders(");
  const body = source.slice(start, source.indexOf("\n}\n", start) + 3);
  const candidates = [{ id: "late-deposit", tenant_id: "tenant-a" }, { id: "new-tab", tenant_id: "tenant-b" },
    { id: "ordinary", tenant_id: "tenant-c" }];
  const transactions: any[] = [], movements: string[] = [];
  const assertOwnedFilters = (sql: string) => {
    assert.match(sql, /restaurant_check_id IS NULL/);
    assert.match(sql, /board_game_session_id IS NULL/);
    assert.match(sql, /board_game_billing_group_id IS NULL/);
  };
  const deps = {
    query: async (sql: string) => {
      assertOwnedFilters(sql); assert.match(sql, /NOT EXISTS[\s\S]*bms_pos_deposits/);
      return rows(candidates);
    },
    getClient: async () => {
      const tx = { tenant: "", locked: false, calls: [] as string[], writes: 0, released: false,
        release() { tx.released = true; },
        query: async (sql: string, params: any[] = []) => {
          tx.calls.push(sql);
          const candidate = candidates[transactions.indexOf(tx)];
          assert.equal(tx.tenant, candidate.tenant_id);
          if (sql === "COMMIT" || sql === "ROLLBACK") return rows();
          if (sql.includes("FROM bms_orders")) {
            assertOwnedFilters(sql); assert.match(sql, /tenant_id = \$2/); assert.match(sql, /FOR UPDATE SKIP LOCKED/);
            assert.deepEqual(params, [candidate.id, candidate.tenant_id, 30]); tx.locked = true;
            return rows(candidate.id === "new-tab" ? [] : [{ id: candidate.id }]);
          }
          if (sql.includes("FROM bms_pos_deposits")) {
            assert.ok(tx.locked, "deposit evidence must be read after locking the order");
            assert.deepEqual(params, [candidate.tenant_id, candidate.id]);
            return rows(candidate.id === "late-deposit" ? [{}] : []);
          }
          if (/^\s*UPDATE/.test(sql)) {
            assert.equal(candidate.id, "ordinary"); assert.match(sql, /tenant_id = \$2/);
            assert.deepEqual(params, [[candidate.id], candidate.tenant_id]); tx.writes++; return rows([{}]);
          }
          throw new Error(`Unexpected expiry SQL: ${sql}`);
        } };
      transactions.push(tx); return tx;
    },
    beginTenantTx: async (tx: any, tenant: string) => { tx.tenant = tenant; },
    recordOrderMovements: async (_c: any, ids: string[]) => { movements.push(...ids); },
    releaseCouponForOrdersInTx: async () => {}, releaseCustomerCouponReservationsInTx: async () => {},
    reopenRestockSubscriptionsForOrders: async () => {}, markRestockSubscriptionsReadyForOrders: async () => {},
  };
  const service: any = {};
  new Function("exports", ...Object.keys(deps), ts.transpileModule(body, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(service, ...Object.values(deps));
  assert.deepEqual(await service.releaseExpiredOrders(30), { released: 1, orderIds: ["ordinary"], failed: [] });
  assert.deepEqual(movements, ["ordinary"]);
  assert.deepEqual(transactions.map(tx => [tx.calls.at(-1), tx.writes, tx.released]),
    [["ROLLBACK", 0, true], ["ROLLBACK", 0, true], ["COMMIT", 2, true]]);
});

for (const countedQty of [1.5, -0.5, NaN, Infinity, 2147483648, null, undefined, "", false]) {
  test(`stock count rejects invalid integer quantity ${countedQty} before opening a transaction`, async () => {
    const service = load("stockCounts", {
      "@/lib/db": { getClient: async () => assert.fail("invalid count must not access DB") },
      "./inventoryIdempotency": { inventoryIdempotency: () => null },
    });
    assert.equal((await service.recordCountItem({ tenantId: "tenant", countId: "count",
      sku: "SKU", size: "BASE", countedQty, actorUserId: "actor" })).status, "INVALID");
  });
}

test("REST and staff GraphQL reject omitted counts while preserving explicit zero", async () => {
  const service = load("stockCounts", {
    "@/lib/db": { getClient: async () => assert.fail("invalid count must not access DB") },
    "./inventoryIdempotency": { inventoryIdempotency: () => null },
  });
  const recordCountItem = async (input: any) => input.countedQty === 0
    ? { status: "OK", snapshotQty: 5, variance: -5 } : service.recordCountItem(input);
  const deps = {
    "next/server": { NextResponse: { json: (body: unknown, options: any) => ({ body, ...options }) } },
    "@/lib/bms/adminRouteAuth": { authorizeAdminRoute: async () => ({ ok: true, tenantId: "tenant", adminId: "actor" }) },
    "@/lib/log/routeError": { withRouteErrorLog: (_label: string, fn: any) => fn },
    "@/lib/bms/stockCounts": { recordCountItem },
    "@/lib/auth": { requireAuth: () => ({ author_id: "actor" }) },
    "@/lib/bms/permissions": { requirePermission: async () => {} },
    "@/lib/bms/tenant": { getTenantId: () => "tenant" },
  };
  const rest = load("../../app/api/bms/inventory/counts/route", deps);
  const gql = load("../../graphql/bmsMobileOperations", deps);
  for (const countedQty of [undefined, null, "", false, 0]) {
    const input = { action: "item", countId: "00000000-0000-4000-8000-000000000001", sku: "SKU", size: "BASE", countedQty };
    const response = await rest.POST({ json: async () => input });
    assert.equal(response.status, countedQty === 0 ? 200 : 400);
    assert.equal((await gql.bmsMobileOperationsResolvers.Mutation.bmsStockCount(null, { input }, {})).status,
      countedQty === 0 ? "OK" : "INVALID");
  }
});

test("REST PO receipt forwards lot evidence and the authenticated actor", async () => {
  const route = load("../../app/api/bms/purchase/[id]/receive/route", {
    "next/server": { NextResponse: { json: (body: unknown, options: any) => ({ body, ...options }) } },
    "@/lib/bms/adminRouteAuth": { authorizeAdminRoute: async () => ({ ok: true, tenantId: "tenant", adminId: "actor" }) },
    "@/lib/log/routeError": { withRouteErrorLog: (_label: string, fn: any) => fn },
    "@/lib/bms/purchase": { receivePurchaseOrder: async (...args: unknown[]) => {
      assert.deepEqual(args, ["tenant", "po", [{ sku: "SKU", size: "BASE", qty: 2, lotNo: "A", expiryDate: "2027-01-01" }], "actor", "actor", { staffIdempotency: { actorUserId: "actor", key: "receipt-key" } }]);
      return { status: "RECEIVED" };
    } },
  });
  assert.equal((await route.POST({ json: async () => ({ idempotencyKey: "receipt-key", items: [{ sku: "SKU", size: "BASE", qty: 2,
    lotNo: " A ", expiryDate: "2027-01-01" }] }) }, { params: { id: "po" } })).status, 200);
});

test("receipt rejects malformed quantity and lot types before any database access", async () => {
  const service = load("purchase", {});
  for (const patch of [{qty:true}, {qty:[1]}, {qty:"1"}, {qty:2147483648}, {qty:1.5},
    {qty:NaN}, {qty:Infinity}, {lotNo:123}, {expiryDate:20270101}, {sku:123}, {size:1}]) {
    const result = await service.receivePurchaseOrderInTx({ query: () => assert.fail("invalid input accessed DB") },
      "tenant", "po", [{sku:"SKU",size:"BASE",qty:1,...patch}]);
    assert.equal(result.status,"INVALID_INPUT",JSON.stringify(patch));
  }
});

for (const surface of ["staff", "pos"]) test(`${surface} REST receipt refuses JSON coercion and malformed lot evidence`, async () => {
  const id="00000000-0000-4000-8000-000000000001";
  const route=load(surface === "staff" ? "../../app/api/bms/purchase/[id]/receive/route" : "../../app/api/pos/purchase/route", {
    "next/server": { NextResponse: { json: (body: unknown, options: any) => ({ body, ...options }) } },
    "@/lib/bms/adminRouteAuth": { authorizeAdminRoute: async () => ({ ok:true, tenantId:"tenant", adminId:"actor" }) },
    "@/lib/bms/pos": { authenticatePosDevice: async () => ({tenantId:"tenant",id,locationId:id}),
      verifyCashierPin: async () => ({ok:true,userId:id}), cashierHasPermission: async () => true },
    "@/lib/log/routeError": { withRouteErrorLog: (_label: string, fn: any) => fn },
    "@/lib/bms/purchase": { receivePurchaseOrder: () => assert.fail("invalid input reached mutation") },
  });
  for (const patch of [{qty:true}, {qty:[1]}, {qty:"1"}, {lotNo:123}, {expiryDate:20270101}, {sku:123}, {size:1}]) {
    const response=await route.POST({ headers:{get:()=>"FAKE-token"}, json:async()=>({action:"receive",poId:id,
      cashierUserId:id,pin:"1234",idempotencyKey:"receipt-key",items:[{sku:"SKU",size:"BASE",qty:1,...patch}]}) },{params:{id}});
    assert.equal(response.status,400,JSON.stringify(patch));
    assert.equal(response.body.status,"INVALID_INPUT");
  }
  assert.equal((await route.POST({headers:{get:()=>"FAKE-token"},json:async()=>null},{params:{id}})).status,400);
});

test("POS receipt guards prevent writes and stale PO status is explained without internal codes", async () => {
  const id="00000000-0000-4000-8000-000000000001";
  let device=true, pin=true, permission=true, status="RECEIVED";
  const route=load("../../app/api/pos/purchase/route", {
    "next/server": { NextResponse: { json: (body: unknown, options: any) => ({ body, ...options }) } },
    "@/lib/bms/pos": { authenticatePosDevice: async () => device ? {tenantId:"tenant",id,locationId:id} : null,
      verifyCashierPin: async () => ({ok:pin,userId:id}), cashierHasPermission: async () => permission },
    "@/lib/bms/posApprovals": { posPermissionDeniedMessage: async()=>"ไม่มีสิทธิ์รับสินค้า" },
    "@/lib/log/routeError": { withRouteErrorLog: (_label: string, fn: any) => fn },
    "@/lib/bms/purchase": { receivePurchaseOrder: () => assert.fail("denied input reached mutation"),
      getPurchaseOrder: async(tenant:string,po:string)=>{assert.equal(tenant,"tenant");assert.equal(po,id);return {status};} },
  });
  const request={headers:{get:()=>"FAKE-token"},json:async()=>({action:"detail",poId:id,cashierUserId:id,pin:"1234"})};
  device=false; assert.equal((await route.POST(request)).status,401);
  device=true; pin=false; assert.equal((await route.POST(request)).status,403);
  pin=true; permission=false; assert.equal((await route.POST(request)).status,403);
  permission=true;
  for(status of ["RECEIVED","CANCELLED"]) {
    const result=await route.POST(request);
    assert.equal(result.status,409);
    assert.equal(result.body.status,"INVALID_STATE");
    assert.doesNotMatch(result.body.error,/RECEIVED|CANCELLED/);
    assert.match(result.body.error,/โหลดใบสั่งซื้อค้างรับใหม่/);
  }
});

test("count apply rolls back earlier lines when a negative variance has no inventory row", async () => {
  let stock = 5, saved = stock, movements = 0;
  const calls: string[] = [];
  const client = { release() {}, query: async (sql: string, params: any[] = []) => {
    calls.push(sql);
    if (sql === "BEGIN") { saved = stock; return rows(); }
    if (sql === "ROLLBACK") { stock = saved; movements = 0; return rows(); }
    if (sql.includes("FROM bms_stock_counts")) return rows([{ status: "DRAFT", location_id: "branch" }]);
    if (sql.includes("FROM bms_stock_count_items")) return rows([
      { product_sku: "A", size: "BASE", snapshot_qty: 5, counted_qty: 6 },
      { product_sku: "B", size: "BASE", snapshot_qty: 5, counted_qty: 4 },
    ]);
    if (sql.includes("FROM bms_inventory_lots")) return rows();
    if (sql.includes("FROM bms_inventory")) return rows(params[2] === "A" ? [{ current_stock: stock, reserved_stock: 0 }] : []);
    if (sql.includes("UPDATE bms_inventory")) { stock += params[4]; return rows([{}]); }
    throw new Error(`Unexpected count commit: ${sql}`);
  } };
  const service = load("stockCounts", {
    "@/lib/db": { getClient: async () => client }, "./tenant": { beginTenantTx: async () => client.query("BEGIN") },
    "./lotQuality": quality, "./movements": { recordMovement: async () => { movements++; } },
    "./inventoryIdempotency": { inventoryIdempotency: () => null, replayInventoryResult: async () => null },
  });
  const result = await service.applyStockCount({ tenantId: "tenant", countId: "count", actorUserId: "actor" });
  assert.equal(result.status, "WOULD_BREAK_RESERVED"); assert.equal(result.wouldBe, -1);
  assert.equal(stock, 5); assert.equal(movements, 0); assert.equal(calls.at(-1), "ROLLBACK");
});

for (const scenario of ["lot required", "expiry requires lot", "expiry required", "plain", "tracked"]) {
  test(`first PO receipt enforces product tracking policy: ${scenario}`, async () => {
    const writes: string[] = [];
    const client = { query: async (sql: string) => {
      if (sql.includes("FROM bms_locations")) return rows([{ id: "branch" }]);
      if (sql.includes("FROM bms_purchase_orders")) return rows([{ status: "OPEN" }]);
      if (sql.includes("COUNT(*)")) return rows([{ c: 0 }]);
      if (sql.includes("FROM bms_purchase_order_items")) return rows([{ id: "line", qty_ordered: 5,
        qty_received: 0, unit_cost: "10", additional_unit_cost: "0" }]);
      if (sql.includes("FROM bms_product_stock_policies")) return rows([{
        lot_tracking: scenario === "lot required" || scenario === "tracked",
        expiry_tracking: scenario.startsWith("expiry") || scenario === "tracked",
      }]);
      if (/^\s*(INSERT|UPDATE)/.test(sql)) { writes.push(sql); return rows([{ id: "lot" }]); }
      throw new Error(`Unexpected SQL: ${sql}`);
    } };
    const service = load("purchase", {
      "./lots": { validateTransferLotReceiptInTx: async () => null, receiveLotInTx: async () => "lot" },
      "./movements": { recordMovement: async () => "movement" },
      "./realtimeOutbox": { realtimeEvent: (x: unknown) => x, enqueueRealtimeEventInTx: async () => {} },
    });
    const result = await service.receivePurchaseOrderInTx(client, "tenant", "po", [{ sku: "SKU", size: "BASE", qty: 1,
      lotNo: ["expiry required", "tracked"].includes(scenario) ? "A" : null,
      expiryDate: scenario === "tracked" ? "2027-01-01" : null,
    }], "actor", { locationId: "branch" });
    if (["plain", "tracked"].includes(scenario)) {
      assert.equal(result.status, "RECEIVED"); assert.ok(writes.length);
    } else {
      assert.equal(result.status, "INVALID_INPUT"); assert.deepEqual(writes, []);
      assert.match(result.reason, /SKU\/BASE: ต้องระบุ(เลขล็อต|วันหมดอายุ)/);
      assert.equal(result.reasonCode, scenario === "expiry required" ? "EXPIRY_REQUIRED" : "LOT_REQUIRED");
    }
  });
}

for (const scenario of ["missing allocation", "partial allocation", "lot mismatch", "missing inventory", "policy only", "plain", "tracked"]) {
  test(`full order return reconciles stock and lots atomically: ${scenario}`, async () => {
    const tracked = !["plain", "policy only"].includes(scenario);
    const allocated = ["missing allocation", "plain", "policy only"].includes(scenario) ? 0 : scenario === "partial allocation" ? 1 : 2;
    let state = { stock: 5, lot: scenario === "lot mismatch" ? 4 : tracked ? 5 : 0, returned: false, movements: 0 };
    let before = structuredClone(state);
    const calls: string[] = [];
    const client = { release() {}, async query(sql: string, params: any[] = []) {
      calls.push(sql);
      if (sql === "BEGIN") { before = structuredClone(state); return rows(); }
      if (sql === "ROLLBACK") { state = structuredClone(before); return rows(); }
      if (sql === "COMMIT") return rows();
      if (sql.includes("UPDATE bms_orders")) { state.returned = true; return rows([{}]); }
      if (sql.includes("UPDATE bms_inventory inv")) { if (scenario !== "missing inventory") state.stock += 2; return rows(); }
      if (sql.includes("UPDATE bms_inventory_lots")) { state.lot += allocated; return rows([{}]); }
      if (sql.includes("FROM bms_order_stock_lines") && !sql.includes("FROM bms_order_item_lots")) {
        return rows([{ location_id: "branch", product_sku: "SKU", size: "BASE", qty: 2,
          lot_tracking: scenario === "policy only", expiry_tracking: false }]);
      }
      if (sql.includes("FROM bms_order_item_lots")) return rows(allocated ? [{ lot_id: "lot", lot_no: "A", expiry_date: null, qty: allocated }] : []);
      if (sql.includes("FROM bms_inventory_lots")) return rows(tracked ? [{ lot_no: "A", expiry_date: null, qty: state.lot }] : []);
      if (sql.includes("FROM bms_inventory")) return rows(scenario === "missing inventory" ? [] : [{ current_stock: state.stock }]);
      throw new Error(`Unexpected return SQL: ${sql}`);
    } };
    const orderLots = load("orderLots", { "./lots": load("lots", {}), "./lotQuality": { inheritQualityHold: async () => {} } });
    const source = readFileSync(new URL("../apps/web/lib/bms/orders.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const start = source.indexOf("export async function returnOrder(");
    const body = source.slice(start, source.indexOf("\n}\n", start) + 3);
    const deps = {
      getClient: async () => client, beginTenantTx: async () => client.query("BEGIN"),
      assertNoActiveSalesTaxDocumentInTx: async () => {}, ...orderLots,
      recordOrderMovements: async () => { state.movements++; }, releasePointsForOrdersInTx: async () => {},
      reverseCreditForOrderInTx: async () => {}, reopenRestockSubscriptionsForOrders: async () => {},
      markRestockSubscriptionsReadyForOrders: async () => {}, notifyOrderStatusEmail: async () => {},
    };
    const service: any = {};
    new Function("exports", ...Object.keys(deps), ts.transpileModule(body, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText)(service, ...Object.values(deps));
    if (["plain", "tracked"].includes(scenario)) {
      assert.equal(await service.returnOrder("tenant", "order"), true);
      assert.deepEqual(state, { stock: 7, lot: tracked ? 7 : 0, returned: true, movements: 1 });
      assert.equal(calls.at(-1), "COMMIT");
    } else {
      await assert.rejects(service.returnOrder("tenant", "order"), /STOCK_REVIEW_REQUIRED/);
      assert.deepEqual(state, before); assert.equal(calls.at(-1), "ROLLBACK");
    }
  });
}

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
    if (sql.includes("FROM bms_product_stock_policies")) return rows();
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
