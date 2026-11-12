import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");

function routeHarness(allowed = true) {
  const calls: unknown[][] = [];
  const mocks: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, options?: { status?: number }) =>
      ({ body, status: options?.status ?? 200 }) } },
    "@/lib/bms/payments": { confirmPayment: async (...args: unknown[]) => {
      calls.push(args);
      return { status: "CONFIRMED", orderPaid: true };
    } },
    "@/lib/bms/adminRouteAuth": { authorizeAdminRoute: async (permission: string) => {
      assert.equal(permission, "payment.confirm");
      return allowed ? { ok: true, tenantId: "tenant-a", adminId: "admin-1" } : { ok: false, status: 403 };
    } },
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
  };
  const module = { exports: {} as Record<string, any> };
  const source = ts.transpileModule(read("apps/web/app/api/bms/payment/[id]/confirm/route.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", source)((name: string) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, module, module.exports);
  return { POST: module.exports.POST as (req: Request, context: { params: { id: string } }) => Promise<any>, calls };
}

const request = (body?: unknown) => new Request("https://bms.example.test/api/bms/payment/p1/confirm", {
  method: "POST", headers: { "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test("payment confirm REST denies missing human confirmation before touching money", async () => {
  const h = routeHarness();
  for (const body of [undefined, {}, { confirmed: false }, { confirmed: "true" }]) {
    const result = await h.POST(request(body), { params: { id: "p1" } });
    assert.equal(result.status, 400);
  }
  assert.equal(h.calls.length, 0);
  const denied = routeHarness(false);
  assert.equal((await denied.POST(request({ confirmed: true }), { params: { id: "p1" } })).status, 403);
  assert.equal(denied.calls.length, 0);
});

test("confirmed REST call uses authenticated tenant and actor", async () => {
  const h = routeHarness();
  const result = await h.POST(request({ confirmed: true, tenantId: "forged" }), { params: { id: "p1" } });
  assert.equal(result.status, 200);
  assert.deepEqual(h.calls, [["tenant-a", "p1", "admin-1"]]);
});

test("GraphQL and both human confirmation surfaces send the explicit flag", () => {
  const resolver = read("apps/web/graphql/bmsPayments.ts").split("async bmsConfirmPayment(")[1].split("async bmsRejectPayment(")[0];
  assert.match(resolver, /requirePermission\(ctx, "payment\.confirm"\)/);
  assert.match(resolver, /args\.confirmed !== true/);
  assert.ok(resolver.indexOf("args.confirmed !== true") < resolver.indexOf("confirmPayment("));
  const page = read("apps/web/app/(admin)/admin/payment/page.tsx");
  assert.match(page, /bmsConfirmPayment\(id: \$id, confirmed: true\)/);
  assert.match(page, /<Popconfirm key="confirm"[\s\S]*?baht\(r\.amount\)[\s\S]*?METHOD_LABEL\[r\.method\]/);
  const assistant = read("apps/web/components/work-assistant/confirmMutations.ts");
  assert.match(assistant, /bmsConfirmPayment\(id: \$id, confirmed: true\)/);
});
