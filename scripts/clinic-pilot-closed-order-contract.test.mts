import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");

test("a cancelled clinic order is not reported as an active replay", async () => {
  let orderStatus = "CANCELLED";
  const client = { query: async (sql: string) => {
    if (sql.includes("FROM bms_clinic_charge_sheets s")) return { rows: [{
      status: "ORDER_CREATED", order_id: "order-1", location_id: "location-1",
    }] };
    if (sql.includes("FROM bms_orders")) return { rows: [{
      total_amount: "100.00", shipping_fee: "0.00", status: orderStatus,
    }] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  class ClinicError extends Error { constructor(public code: string, public status = 400) { super(code); } }
  const mocks: Record<string, unknown> = {
    "../orders": { createOrderInTx: async () => { throw new Error("duplicate order"); } },
    "../productPacks": { getVariantBasePriceInTx: async () => null },
    "./access": {
      ClinicError, auditClinicRead: async () => undefined, auditClinicWrite: async () => undefined,
      boundedText: (value: string) => value, uuid: (value: string) => value,
      clinicTx: async (_tenantId: string, _actorId: string, fn: (db: unknown) => Promise<unknown>) => fn(client),
      requireClinicRole: async () => undefined,
    },
  };
  const source = readFileSync(path.join(root, "apps/web/lib/bms/clinic/billing.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", compiled)((name: string) => {
    assert.ok(name in mocks, `Unexpected import ${name}`);
    return mocks[name];
  }, module, module.exports);
  const create = () => module.exports.createClinicChargeOrder({
    tenantId: "tenant-a", actorId: "cashier-a", sheetId: "sheet-1",
    confirmation: "CREATE CLINIC ORDER",
  });
  await assert.rejects(create(), /CHARGE_ORDER_CLOSED_REVIEW_REQUIRED/);
  orderStatus = "PENDING";
  assert.deepEqual(await create(), { status: "REPLAYED", orderId: "order-1", amountDue: 100 });
});
