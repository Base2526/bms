import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as policy from "../apps/web/lib/bms/operationChecklistPolicy.ts";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
function load(name: string, deps: Record<string, any>) {
  const source = readFileSync(new URL(`../apps/web/lib/bms/${name}.ts`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} as any };
  new Function("require", "module", "exports", compiled)(
    (key: string) => key in deps ? deps[key] : require(key), module, module.exports,
  );
  return module.exports;
}
const rows = (items: any[] = []) => ({ rows: items, rowCount: items.length });
const scope = { tenantId: "tenant", actorId: "actor", permissions: new Set(["operations.checklist.view", "operations.checklist.execute"]) };
const runId = "11111111-1111-4111-8111-111111111111";

function evidenceHarness(options: { stale?: boolean; failAudit?: boolean; lostCommit?: boolean; denied?: boolean; missingFile?: boolean; failRegister?: boolean } = {}) {
  let linked = false, committed = false, deleted = false, fileDeleted = false, locks = 0, reads = 0;
  const fileQueries: string[] = [];
  const db = { query: async (sql: string, params: any[]) => {
    fileQueries.push(sql);
    if (sql.startsWith("INSERT INTO files")) {
      assert.equal(params[5], scope.tenantId);
      assert.match(sql, /'private'/);
      if (options.failRegister) throw new Error("register failed");
      return rows([{ id: 7 }]);
    }
    if (sql.startsWith("UPDATE files")) {
      assert.deepEqual(params, [7, scope.tenantId]);
      assert.match(sql, /NOT EXISTS[\s\S]*bms_operation_evidence/);
      if (committed) return rows();
      fileDeleted = true;
      return rows([{ id: 7 }]);
    }
    assert.match(sql, /SELECT relpath FROM files/);
    assert.deepEqual(params, [7, scope.tenantId]);
    assert.match(sql, /deleted_at IS NULL AND visibility='private'/);
    return rows(options.missingFile ? [] : [{ relpath: "evidence.webp" }]);
  } };
  const client = { query: async (sql: string, params: any[]) => {
    // Execute under the real production restriction, not the old fixture's broad grant.
    if (/\bfiles\b/.test(sql)) throw new Error("42501: permission denied for table files");
    assert.equal(params[0], scope.tenantId);
    if (sql.includes("SELECT count(*)")) return rows([{ n: 0 }]);
    if (sql.includes("INSERT INTO bms_operation_evidence")) { linked = true; return rows(); }
    if (sql.includes("SELECT run_id")) return rows([{ run_id: runId }]);
    if (sql.includes("INSERT INTO bms_audit_log") && options.failAudit) throw new Error("audit failed");
    return rows();
  } };
  const service = load("operationChecklistEvidence", {
    "@/lib/db": db,
    "@/lib/storage": {
      writeWebFileStream: async () => ({ filename: "operation-evidence-test.webp", original_name: "test.webp", size: 10, checksum: "test", relpath: "evidence.webp" }),
      readStoredFile: async () => { reads++; return Buffer.from("private image"); },
    },
    "@/lib/storageDrivers": { getStorageDriver: () => ({ delete: async () => { deleted = true; } }) },
    "./operationChecklistPolicy": policy,
    "./operationChecklists": {
      checklistPermission: (s: any, permission: string) => {
        if (!s.permissions.has(permission)) throw new Error("FORBIDDEN");
      },
      lockChecklistRun: async () => {
        locks++;
        if (options.denied) throw new Error("NOT_FOUND");
        return { status: "OPEN", version: options.stale && locks > 1 ? 2 : 1, assigned_to: scope.actorId, snapshot: { items: [{ key: "photo" }] } };
      },
      checklistTx: async (_s: any, work: any) => {
        let result;
        try { result = await work(client); }
        catch (error) { linked = false; throw error; }
        if (linked) {
          committed = true;
          if (options.lostCommit) throw new Error("commit response lost");
        }
        return result;
      },
    },
  });
  return { service, fileQueries, state: () => ({ committed, deleted, fileDeleted, reads }) };
}
const image = async () => require("sharp")({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
test("operations evidence uploads and downloads without granting files access to bms_app", async () => {
  const h = evidenceHarness();
  assert.deepEqual(await h.service.uploadChecklistEvidence(scope, runId, "photo", 1, await image()), { status: "OK", fileId: 7 });
  assert.equal((await h.service.checklistEvidenceFile(scope, 7)).toString(), "private image");
  assert.equal(h.state().committed, true);
  assert.equal(h.state().deleted, false);
});
test("denied evidence never reaches file metadata or bytes; deleted/private ownership check fails closed", async () => {
  const denied = evidenceHarness({ denied: true });
  await assert.rejects(denied.service.checklistEvidenceFile(scope, 7), /NOT_FOUND/);
  assert.equal(denied.fileQueries.length, 0);
  assert.equal(denied.state().reads, 0);
  const missing = evidenceHarness({ missingFile: true });
  await assert.rejects(missing.service.checklistEvidenceFile(scope, 7), /NOT_FOUND/);
  assert.equal(missing.state().reads, 0);
});
test("stale upload and audit failure clean orphan files; lost commit preserves attached evidence", async () => {
  for (const [options, message] of [
    [{ stale: true }, /STALE_VERSION/], [{ failAudit: true }, /audit failed/],
    [{ failRegister: true }, /register failed/],
  ] as const) {
    const h = evidenceHarness(options);
    await assert.rejects(h.service.uploadChecklistEvidence(scope, runId, "photo", 1, await image()), message);
    assert.equal(h.state().deleted, true);
    assert.equal(h.state().committed, false);
  }
  const h = evidenceHarness({ lostCommit: true });
  await assert.rejects(h.service.uploadChecklistEvidence(scope, runId, "photo", 1, await image()), /commit response lost/);
  assert.equal(h.state().committed, true);
  assert.equal(h.state().deleted, false);
  assert.equal(h.state().fileDeleted, false);
});

async function reserve(stock: number | null, lots: any[], qty: number, failMovement = false) {
  let reserved = 0, movements = 0, released = false;
  const calls: string[] = [];
  const client = {
    release() { released = true; },
    async query(sql: string, params?: any[]) {
      calls.push(sql);
      if (sql === "ROLLBACK") { reserved = 0; movements = 0; return rows(); }
      if (sql === "COMMIT") return rows();
      assert.equal(params?.[0], scope.tenantId);
      if (sql.startsWith("SELECT current_stock,reserved_stock")) return rows(stock === null ? [] : [{ current_stock: stock, reserved_stock: reserved }]);
      if (sql.includes("FROM bms_inventory_lots")) return rows(lots);
      if (sql.includes("SET reserved_stock")) { reserved += qty; return rows([{ available_after: stock! - reserved }]); }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  // Clock has no tenant arguments; all stock SQL still goes through the scoped boundary above.
  const query = client.query.bind(client);
  client.query = async (sql: string, params?: any[]) => sql.includes("AS day") ? rows([{ day: "2026-10-26" }]) : query(sql, params);
  const quality = load("lotQuality", { "./operationQualityDispatch": {} });
  const service = load("stock", {
    "@/lib/db": { getClient: async () => client }, "./tenant": { beginTenantTx: async () => {} },
    "./lotQuality": quality, "./locations": {}, "./products": {}, "./productPacks": {},
    "./movements": { recordMovement: async () => { if (failMovement) throw new Error("movement failed"); movements++; } },
  });
  try {
    const result = await service.reserveStock({ tenantId: scope.tenantId, locationId: "branch", sku: "sku", size: "BASE", qty });
    return { result, reserved, movements, released, calls };
  } catch (error) {
    assert.equal(reserved, 0);
    assert.equal(released, true);
    assert.ok(calls.includes("ROLLBACK"));
    throw error;
  }
}
test("reservation preserves missing versus zero stock and ordinary untracked retail behavior", async () => {
  assert.equal((await reserve(null, [], 1)).result.status, "NOT_FOUND");
  assert.equal((await reserve(0, [], 1)).result.status, "INSUFFICIENT");
  const h = await reserve(10, [], 3);
  assert.equal(h.result.availableAfter, 7);
  assert.equal(h.reserved, 3);
  assert.equal(h.movements, 1);
  assert.equal(h.released, true);
});
test("reservation reports only usable remainder, rejects excess/mismatched lots and rolls back failed movement", async () => {
  const lots = [
    { id: "held", qty: 6, usable: false, expiry_date: null },
    { id: "healthy", qty: 3, usable: true, expiry_date: null },
    { id: "expired", qty: 1, usable: true, expiry_date: "2026-10-25" },
  ];
  const h = await reserve(10, lots, 2);
  assert.equal(h.result.availableAfter, 1);
  const denied = await reserve(10, lots, 4);
  assert.equal(denied.result.available, 3);
  assert.equal(denied.movements, 0);
  assert.equal((await reserve(11, lots, 1)).result.available, 0);
  await assert.rejects(reserve(10, lots, 2, true), /movement failed/);
});

function restockHarness(usable: number) {
  const quality = load("lotQuality", { "./operationQualityDispatch": {} });
  let sent = 0, attempts = 0, demoted = false;
  const stockReads: string[] = [];
  const service = load("restockSubscriptions", {
    "./lotQuality": quality,
    "./inbox": { channelSupportsPush: () => true, sendStaffMessage: async () => {
      sent++; return { status: "SENT", delivered: true, messageId: 1 };
    } },
    "@/lib/db": { query: async (sql: string, params: any[]) => {
      assert.equal(params[0], scope.tenantId);
      if (sql.includes("FROM bms_inventory i") || sql.includes("JOIN bms_inventory i")) {
        stockReads.push(sql);
        // A physical shelf of 10 can have zero usable units. Exercise actual service
        // branches with the shared SQL policy; database execution remains a separate suite.
        const available = sql.includes(quality.usableStockSql("i")) ? usable : 10;
        if (sql.startsWith("UPDATE")) return rows(available > 0 ? [{}] : []);
        return rows([{ id: "subscription", name: "Product", product_name: "Product", product_sku: "sku", size: "BASE",
          available, status: "READY_TO_NOTIFY", conversation_id: "conversation", channel: "line" }]);
      }
      if (sql.includes("INSERT INTO bms_conversations")) return rows([{ id: "conversation", customer_id: null }]);
      if (sql.includes("INSERT INTO bms_restock_subscriptions")) return rows([{ id: "subscription" }]);
      if (sql.includes("SELECT status, completed_at")) return rows();
      if (sql.includes("INSERT INTO bms_restock_deliveries")) { attempts++; return rows([{ id: "delivery", attempt_no: 1 }]); }
      if (sql.includes("SELECT COUNT(*)")) return rows([{ total: 1 }]);
      if (sql.includes("SELECT s.id")) return rows([{ id: "subscription" }]);
      if (sql.includes("status = 'ACTIVE'")) demoted = true;
      return rows();
    } },
  });
  return { service, stockReads, state: () => ({ sent, attempts, demoted }) };
}
test("held-only restock accepts a wait request but cannot become ready or send a customer message", async () => {
  const h = restockHarness(0);
  assert.equal((await h.service.subscribeToRestock({ tenantId: scope.tenantId, channel: "line", customerRef: "customer", sku: "sku", size: "BASE" })).status, "SUBSCRIBED");
  assert.equal(await h.service.markRestockSubscriptionsReady(scope.tenantId, "sku", "BASE"), 0);
  assert.equal((await h.service.listRestockSubscriptions(scope.tenantId)).items[0].available, 0);
  assert.equal((await h.service.sendRestockNotification(scope.tenantId, "subscription", "Back in stock", scope.actorId)).status, "OUT_OF_STOCK");
  assert.deepEqual(await h.service.sendAllReadyRestockNotifications(scope.tenantId, scope.actorId), { attempted: 1, sent: 0, failed: 1 });
  assert.deepEqual(h.state(), { sent: 0, attempts: 0, demoted: true });
  assert.equal(h.stockReads.length, 6);
});
test("healthy restock retains subscription/ready/send behavior and reports usable quantity only", async () => {
  const h = restockHarness(3);
  const result = await h.service.subscribeToRestock({ tenantId: scope.tenantId, channel: "line", customerRef: "customer", sku: "sku", size: "BASE" });
  assert.equal(result.status, "IN_STOCK");
  assert.equal(result.available, 3);
  assert.equal(await h.service.markRestockSubscriptionsReady(scope.tenantId, "sku", "BASE"), 1);
  assert.equal((await h.service.listRestockSubscriptions(scope.tenantId)).items[0].available, 3);
  assert.equal((await h.service.sendRestockNotification(scope.tenantId, "subscription", "Back in stock", scope.actorId)).status, "SENT");
  assert.deepEqual(h.state(), { sent: 1, attempts: 1, demoted: false });
});
