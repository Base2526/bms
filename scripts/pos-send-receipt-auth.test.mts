import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");
const source = ts.transpileModule(
  readFileSync(new URL("../apps/web/app/api/pos/send-receipt/route.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function routeHarness(hasPermission: boolean) {
  let deliveries = 0;
  const module = { exports: {} as Record<string, any> };
  const mocks: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, options?: { status?: number }) =>
      ({ body, status: options?.status ?? 200 }) } },
    "@/lib/bms/pos": {
      authenticatePosDevice: async () => ({ id: "device-a", tenantId: "tenant-a" }),
      verifyCashierPin: async () => ({ ok: true, userId: "cashier-a" }),
      cashierHasPermission: async (tenantId: string, userId: string, permission: string) => {
        assert.deepEqual([tenantId, userId, permission], ["tenant-a", "cashier-a", "pos.sell"]);
        return hasPermission;
      },
      isPosOrderOwnedByDevice: async () => true,
    },
    "@/lib/bms/receiptDelivery": { sendReceipt: async () => { deliveries++; return { status: "SENT" }; } },
    "@/lib/bms/posApprovals": { posPermissionDeniedMessage: async () => "Ask a manager for pos.sell" },
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
  };
  new Function("require", "module", "exports", source)((name: string) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, module, module.exports);
  return {
    POST: module.exports.POST as (request: Request) => Promise<{ status: number }>,
    deliveries: () => deliveries,
  };
}

const request = () => new Request("https://bms.example.test/api/pos/send-receipt", {
  method: "POST",
  headers: { "content-type": "application/json", "x-pos-device-token": "device-token" },
  body: JSON.stringify({ orderId: "order-a", cashierUserId: "cashier-a", pin: "1234", channel: "email" }),
});

test("receipt delivery denies a valid PIN without pos.sell", async () => {
  const route = routeHarness(false);
  assert.equal((await route.POST(request())).status, 403);
  assert.equal(route.deliveries(), 0);
});

test("receipt delivery proceeds with pos.sell", async () => {
  const route = routeHarness(true);
  assert.equal((await route.POST(request())).status, 200);
  assert.equal(route.deliveries(), 1);
});
