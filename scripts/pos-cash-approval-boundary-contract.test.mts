import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");
const source = readFileSync(path.join(root, "apps/web/lib/bms/pos.ts"), "utf8");
const parsed = ts.createSourceFile("pos.ts", source, ts.ScriptTarget.Latest, true);
function isolatedService(name: string, dbDependency: string) {
  const declaration = parsed.statements.find((node): node is import("typescript").FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `${name} service exists`);
  const compiled = ts.transpileModule(declaration.getText(parsed), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as Record<string, any> };
  new Function("module", "exports", dbDependency, compiled)(module, module.exports, () => {
    throw new Error("DB reached");
  });
  return module.exports[name] as (input: Record<string, unknown>) => Promise<{ status: string }>;
}
const recordCashMovement = isolatedService("recordCashMovement", "getClient");
const voidPosSale = isolatedService("voidPosSale", "query");
const request = (approvedByUserId?: string) => ({
  tenantId: "tenant-a", deviceId: "device-a", shiftId: "shift-a", direction: "OUT",
  amount: 1, reason: "Bank drop", actorUserId: "cashier-a", approvedByUserId,
  idempotencyKey: "drop-1",
});

test("drawer cash-out rejects missing and same-person approval before touching money", async () => {
  for (const approver of [undefined, "cashier-a", " CASHIER-A "]) {
    const result = await recordCashMovement(request(approver));
    assert.equal(result.status, "INVALID");
  }
  await assert.rejects(recordCashMovement(request("manager-b")), /DB reached/);
});

test("void service rejects self-approval before reading or changing a bill", async () => {
  for (const approver of [undefined, "cashier-a", " CASHIER-A "]) {
    const result = await voidPosSale({ ...request(approver), orderId: "order-a", reason: "Duplicate scan" });
    assert.equal(result.status, "NOT_VOIDABLE");
  }
  await assert.rejects(voidPosSale({ ...request("manager-b"), orderId: "order-a", reason: "Duplicate scan" }), /DB reached/);
});

test("cash movement replay refuses changed money instead of reporting the old result as success", async () => {
  const declaration = parsed.statements.find((node): node is import("typescript").FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === "recordCashMovement");
  assert.ok(declaration);
  const compiled = ts.transpileModule(declaration.getText(parsed), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const calls: string[] = [];
  const client = {
    release() {},
    async query(sql: string) {
      calls.push(sql);
      if (sql.includes("FROM bms_pos_shifts")) return { rowCount: 1, rows: [{ id: "shift-a", opening_float: "1000" }] };
      if (sql.includes("FROM bms_pos_cash_movements")) return { rowCount: 1, rows: [{
        id: "movement-a", shift_id: "shift-a", device_id: "device-a", direction: "OUT",
        amount: "1.00", reason: "Bank drop", actor_user_id: "cashier-a", approved_by: "manager-b",
        created_at: "2026-11-12T00:00:00Z",
      }] };
      if (sql === "ROLLBACK") return { rowCount: 0, rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const module = { exports: {} as Record<string, any> };
  new Function("module", "exports", "getClient", "beginTenantTx", "drawerExpectedInTx", "getVatSettings", compiled)(
    module, module.exports, async () => client, async () => {}, async () => 1000,
    async () => ({ blindClose: false }),
  );
  const result = await module.exports.recordCashMovement({ ...request("manager-b"), amount: 2 });
  assert.equal(result.status, "INVALID");
  assert.ok(calls.includes("ROLLBACK"));
  assert.equal(calls.some((sql) => sql.includes("INSERT INTO bms_pos_cash_movements")), false);
});
