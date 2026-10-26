import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "../apps/web/node_modules/typescript/lib/typescript.js";
import * as errors from "../apps/web/lib/bms/restaurantPosErrors.ts";
import * as snapshots from "../apps/web/lib/bms/restaurantItemSnapshots.ts";

const input = { tenantId: "tenant-a", locationId: "branch-a", deviceId: "device-a",
  shiftId: "shift-a", checkId: "check-a", actorUserId: "cashier-a" };
const evidence = (id: string): snapshots.RestaurantItemSnapshot => ({
  version: 1, provenance: "FIRST_SEND", sourceOrderId: "order-old", sourceOrderItemId: id,
  qty: 1, costAmount: 2, costSource: "CATALOG_AT_SALE",
  consumption: { soldSku: "MENU", soldSize: "PLATE", derived: true,
    lines: [{ sku: "RICE", size: "GRAM", qty: 100, source: "RECIPE", sourceRef: "recipe-1", meta: {} }] },
});

// Execute the real send service and snapshot loader. The order engine and database are explicit
// transactional fakes: this verifies orchestration/rollback requests, NOT PostgreSQL atomicity,
// locking, RLS, stock SQL, triggers, or the real createOrderInTx implementation.
function harness() {
  const state = {
    check: { id: input.checkId, tenant_id: input.tenantId, location_id: input.locationId,
      status: "OPEN", current_order_id: "order-old", version: 2, reserved_version: 1, amount_due: 60 },
    items: ["SENT", "NEW"].map((status, i) => ({ id: `item-${i}`, check_id: input.checkId,
      tenant_id: input.tenantId, product_sku: "MENU", size: "PLATE", pack_qty: 1, base_qty: 1,
      pack_code: "BASE", unit_name: "plate", pack_price: null, modifier_codes: [], status,
      round_no: i === 0 ? 1 : null, stock_snapshot: i === 0 ? evidence(`item-${i}`) : null })),
    orders: [{ id: "order-old", status: "PENDING", key: "restaurant:check-a:v1" as string | null }],
    tickets: ["item-0"], audits: [] as any[],
  };
  const controls = { rejectCreate: false, failAudit: false, failLink: false, kitchenOn: true };
  const calls: string[] = [];
  let backup: typeof state | null = null;
  let creates = 0;
  let releases = 0;
  const result = (rows: any[] = []) => ({ rows: structuredClone(rows), rowCount: rows.length });
  const client: any = {
    release() { releases++; },
    async query(sql: string, params: any[] = []) {
      calls.push(sql);
      if (sql === "BEGIN") { assert.equal(backup, null); backup = structuredClone(state); return result(); }
      if (sql === "ROLLBACK") { if (backup) Object.assign(state, backup); backup = null; return result(); }
      if (sql === "COMMIT") { assert.ok(backup); backup = null; return result(); }
      assert.ok(backup, "all service SQL must run within the tenant transaction");
      if (sql.includes("FROM bms_pos_shifts")) return result(
        params[0] === input.tenantId && params[1] === input.shiftId
        && params[2] === input.deviceId && params[3] === input.locationId ? [{}] : []);
      if (sql.includes("FROM bms_restaurant_checks") && !sql.includes("JOIN")) return result(
        params[0] === state.check.tenant_id && params[1] === state.check.id
        && params[2] === state.check.location_id && state.check.status === "OPEN" ? [state.check] : []);
      assert.equal(params[0], input.tenantId);
      if (sql.includes("SELECT * FROM bms_restaurant_check_items")) {
        assert.equal(params[1], input.checkId);
        return result(state.items.filter(i => i.status !== "CANCELLED"));
      }
      if (sql.includes("SELECT oi.*")) return result(); // deliberately missing legacy evidence
      if (sql.includes("SELECT status FROM bms_orders")) return result(state.orders.filter(o => o.id === params[1]));
      if (sql.includes("UPDATE bms_orders SET idempotency_key = NULL")) {
        const order = state.orders.find(o => o.id === params[1] && o.status === "CANCELLED");
        if (order) order.key = null;
        return result();
      }
      if (sql.includes("MAX(round_no)")) return result([{ next_round: Math.max(...state.items.map(i => i.round_no ?? 0)) + 1 }]);
      if (sql.includes("UPDATE bms_restaurant_check_items") && sql.includes("status = 'SENT'")) {
        const items = state.items.filter(i => i.status === "NEW");
        for (const item of items) { item.status = "SENT"; item.round_no = params[2]; }
        return result(items.map(i => ({ id: i.id })));
      }
      if (sql.includes("INSERT INTO bms_restaurant_kitchen_tickets")) {
        const ids = params[2].filter((id: string) => !state.tickets.includes(id));
        state.tickets.push(...ids);
        return result(ids.map((id: string) => ({ id })));
      }
      if (sql.includes("UPDATE bms_restaurant_checks")) {
        if (controls.failLink) return result();
        assert.equal(params[4], state.check.version);
        Object.assign(state.check, { current_order_id: params[2], reserved_version: state.check.version, amount_due: params[3] });
        return result([state.check]);
      }
      if (sql.includes("INSERT INTO bms_audit_log")) {
        if (controls.failAudit) throw new Error("FAKE audit failure");
        assert.equal(params[1], `user:${input.actorUserId}`);
        state.audits.push(JSON.parse(params[3]));
        return result();
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const exports: any = {};
  const source = readFileSync(new URL("../apps/web/lib/bms/restaurantPos.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function("require", "exports", js)((name: string) => {
    if (name === "node:crypto") return { randomUUID };
    if (name === "./restaurantPosErrors") return errors;
    if (name === "./restaurantItemSnapshots") return snapshots;
    if (name === "@/lib/db") return { getClient: async () => client, query: async () => {
      assert.equal(backup, null, "display reload happens only after commit"); return result();
    } };
    if (name === "./tenant") return { beginTenantTx: async (c: any, tenant: string, options: any) => {
      assert.equal(c, client); assert.equal(tenant, input.tenantId);
      assert.equal(options.editorId, input.actorUserId); await c.query("BEGIN");
    } };
    if (name === "./restaurantCheckLock") return { lockRestaurantCheckInTx: async (c: any, tenant: string, check: string) => {
      assert.equal(c, client); assert.equal(tenant, input.tenantId); assert.equal(check, input.checkId);
      assert.ok(backup); calls.push("LOCK_CHECK");
    } };
    if (name === "./storeCapabilities") return { isCapabilityEnabledInTx: async (c: any, tenant: string, capability: string) => {
      assert.equal(c, client); assert.equal(tenant, input.tenantId); assert.equal(capability, "KITCHEN_WORKFLOW");
      return controls.kitchenOn;
    } };
    if (name === "./kitchenStations") return { kitchenStationColumnsSql: () => ({ name: "NULL", id: "NULL" }) };
    if (name === "./orders") return {
      cancelOrderInTx: async (c: any, tenant: string, id: string) => {
        assert.equal(c, client); assert.equal(tenant, input.tenantId); assert.ok(backup);
        calls.push("CANCEL_ORDER"); state.orders.find(o => o.id === id)!.status = "CANCELLED"; return true;
      },
      createOrderInTx: async (c: any, args: any) => {
        creates++; calls.push("CREATE_ORDER");
        assert.equal(c, client); assert.equal(args.tenantId, input.tenantId);
        assert.equal(args.channel, "pos"); assert.equal(args.freezeRestaurantItems, true);
        assert.equal(args.idempotencyKey, "restaurant:check-a:v2");
        const lines = await snapshots.restaurantOrderItemsInTx(c, args.tenantId, args.restaurantCheckId, args.locationId);
        assert.equal(lines.length, 2); assert.deepEqual(lines[0].restaurantStockSnapshot, evidence("item-0"));
        assert.equal(lines[1].restaurantStockSnapshot, undefined);
        // Model writes before a failure to verify the wrapper requests rollback of ALL effects.
        state.items[1].stock_snapshot = { ...evidence("item-1"), sourceOrderId: "order-new" };
        state.orders.push({ id: "order-new", status: "PENDING", key: args.idempotencyKey });
        return controls.rejectCreate ? { status: "INSUFFICIENT_STOCK" }
          : { status: "CREATED", orderId: "order-new", amountDue: 120 };
      },
    };
    if (["./products", "./menuAvailability", "./pos", "./productPacks", "./lotQuality"].includes(name)) return new Proxy({}, {
      get: (_target, key) => { throw new Error(`Unexpected dependency use: ${name}.${String(key)}`); },
    });
    throw new Error(`Unexpected dependency: ${name}`);
  }, exports);
  return { state, controls, calls, counts: () => ({ creates, releases }),
    send: (patch: any = {}) => exports.sendRestaurantKitchenRound({ ...input, ...patch }) };
}

test("next kitchen round preserves SENT evidence and retries do not duplicate tickets, order or audit", async () => {
  const h = harness();
  assert.equal((await h.send()).kitchenTickets, 1);
  assert.deepEqual(h.state.items[0].stock_snapshot, evidence("item-0"));
  assert.deepEqual(h.state.items.map(i => i.round_no), [1, 2]);
  assert.equal(h.state.check.reserved_version, 2);
  assert.equal((await h.send()).kitchenTickets, 0);
  assert.deepEqual(h.state.tickets, ["item-0", "item-1"]);
  assert.equal(h.state.audits.length, 1);
  assert.deepEqual(h.counts(), { creates: 1, releases: 2 });
});

test("rejected replacement rolls back prior cancellation and leaves NEW evidence unfrozen", async () => {
  const h = harness(); const before = structuredClone(h.state); h.controls.rejectCreate = true;
  assert.equal((await h.send()).status, "INSUFFICIENT_STOCK");
  assert.deepEqual(h.state, before);
  assert.ok(h.calls.indexOf("CANCEL_ORDER") < h.calls.indexOf("CREATE_ORDER"));
  assert.equal(h.calls.at(-1), "ROLLBACK");
  h.controls.rejectCreate = false;
  assert.equal((await h.send()).status, "SENT", "retry can complete after rollback");
});

for (const failure of ["failAudit", "failLink"] as const) test(`${failure} rolls back snapshot, ticket, reservation and check together`, async () => {
  const h = harness(); const before = structuredClone(h.state); h.controls[failure] = true;
  await assert.rejects(h.send());
  assert.deepEqual(h.state, before);
  assert.equal(h.calls.at(-1), "ROLLBACK");
  assert.equal(h.counts().releases, 1);
});

test("missing legacy evidence fails before releasing the old reservation", async () => {
  const h = harness(); h.state.items[0].stock_snapshot = null; const before = structuredClone(h.state);
  await assert.rejects(h.send(), (error: unknown) => errors.isRestaurantCheckError(error)
    && error.code === "RESTAURANT_SNAPSHOT_REVIEW_REQUIRED");
  assert.deepEqual(h.state, before);
  assert.ok(!h.calls.includes("CANCEL_ORDER")); assert.equal(h.counts().creates, 0);
});

test("branch/device rejection performs no replacement and releases the client", async () => {
  for (const patch of [{ locationId: "foreign-branch" }, { deviceId: "foreign-device" }]) {
    const h = harness(); const before = structuredClone(h.state);
    await assert.rejects(h.send(patch));
    assert.deepEqual(h.state, before); assert.deepEqual(h.counts(), { creates: 0, releases: 1 });
  }
});

test("recipes-only shop still completes a frozen round without creating kitchen work", async () => {
  const h = harness(); h.controls.kitchenOn = false;
  assert.equal((await h.send()).kitchenTickets, 0);
  assert.deepEqual(h.state.tickets, ["item-0"]);
  assert.equal(h.state.items[1].status, "SENT"); assert.ok(h.state.items[1].stock_snapshot);
  assert.equal(h.state.audits.length, 1);
});

for (const failPurge of [false, true]) test(`tenant purge detaches only its restaurant evidence in the transaction (failure=${failPurge})`, async () => {
  const links = new Map<string, string | null>([["test-tenant", "item-a"], ["other-tenant", "item-b"]]);
  let backup: typeof links | null = null;
  let released = false;
  let detached = false;
  const client = {
    release() { released = true; },
    async query(sql: string, params: any[] = []) {
      if (sql === "BEGIN") { backup = new Map(links); return { rows: [], rowCount: 0 }; }
      if (sql === "ROLLBACK") {
        assert.ok(backup); links.clear(); for (const [id, link] of backup) links.set(id, link);
        backup = null; return { rows: [], rowCount: 0 };
      }
      if (sql === "COMMIT") { backup = null; return { rows: [], rowCount: 0 }; }
      assert.ok(backup, "purge statements stay inside the existing transaction");
      assert.deepEqual(params, [["test-tenant"]], "only the authorized target tenant may be changed");
      if (sql.includes("SET restaurant_check_item_id = NULL")) {
        assert.match(sql, /WHERE tenant_id = ANY\(\$1::uuid\[\]\) AND restaurant_check_item_id IS NOT NULL/);
        detached = true; links.set("test-tenant", null);
      }
      if (sql.includes("DELETE FROM bms_restaurant_checks")) {
        assert.ok(detached, "new FK must be released before check-item cascade");
        assert.equal(links.get("test-tenant"), null);
        if (failPurge) throw new Error("FAKE later purge failure");
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const exports: any = {};
  const source = readFileSync(new URL("../apps/web/lib/bms/platform.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function("require", "exports", js)((name: string) => {
    if (name === "@/lib/db") return { getClient: async () => client, query: async (sql: string, params: any[]) => {
      assert.match(sql, /SELECT slug, name FROM bms_tenants WHERE id = \$1/);
      assert.deepEqual(params, ["test-tenant"]);
      return { rows: [{ slug: "test-snapshot", name: "fixture" }], rowCount: 1 };
    } };
    if (name === "./tenant") return { DEFAULT_TENANT_ID: "default-tenant" };
    if (["graphql/error", "@/lib/auth"].includes(name)) return {};
    throw new Error(`Unexpected dependency: ${name}`);
  }, exports);
  if (failPurge) await assert.rejects(exports.deleteTenant("test-tenant"), /FAKE later purge failure/);
  else await exports.deleteTenant("test-tenant");
  assert.equal(links.get("test-tenant"), failPurge ? "item-a" : null);
  assert.equal(links.get("other-tenant"), "item-b");
  assert.ok(released); assert.equal(backup, null);
});
