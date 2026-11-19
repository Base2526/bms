import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");

test("technical-spec REST authenticates and validates confirmation before using tenant services", async () => {
  const calls: unknown[][] = [];
  let authOk = false;
  const mocks: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, options?: { status?: number }) =>
      ({ body, status: options?.status ?? 200 }) } },
    "@/lib/bms/adminRouteAuth": { authorizeAdminRoute: async (permission: string) => {
      calls.push(["auth",permission]);
      return authOk ? { ok: true, tenantId: "trusted-tenant", adminId: "trusted-staff" }
        : { ok: false, status: 403 };
    } },
    "@/lib/bms/productTechnicalSpecs": {
      listTechnicalSpecs: async (...args: unknown[]) => { calls.push(["list",...args]); return []; },
      stageTechnicalSpecs: async (...args: unknown[]) => { calls.push(["stage",...args]); return { status: "DRAFT", revisionNo: 1 }; },
      publishTechnicalSpecs: async (...args: unknown[]) => { calls.push(["publish",...args]); return { status: "PUBLISHED", revisionNo: 1 }; },
    },
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
  };
  const source = readFileSync(path.join(root,"apps/web/app/api/bms/product-specs/[sku]/route.ts"),"utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as Record<string, any> };
  new Function("require","module","exports",compiled)((name: string) => {
    assert.ok(name in mocks, `unexpected import ${name}`);
    return mocks[name];
  },module,module.exports);
  const get = module.exports.GET as (_req: Request, ctx: { params: { sku: string } }) => Promise<any>;
  const post = module.exports.POST as (_req: Request, ctx: { params: { sku: string } }) => Promise<any>;
  const ctx = { params: { sku: "SKU-1" } };
  const request = (body: object) => new Request("https://bms.example.invalid/api/bms/product-specs/SKU-1", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal((await get(new Request("https://bms.example.invalid"),ctx)).status,403);
  assert.deepEqual(calls,[["auth","product.view"]]);
  calls.length=0;
  assert.equal((await post(request({ action: "STAGE", tenantId: "forged" }),ctx)).status,403);
  assert.deepEqual(calls,[["auth","product.edit"]]);
  calls.length=0;
  authOk=true;
  assert.equal((await post(request({ action: "PUBLISH", variantCode: "STD", revisionNo: 1 }),ctx)).status,400);
  assert.deepEqual(calls,[["auth","product.spec.publish"]]);
  calls.length=0;
  assert.equal((await post(request({ action: "STAGE", tenantId: "forged", variantCode: "STD" }),ctx)).status,200);
  assert.deepEqual(calls[0],["auth","product.edit"]);
  assert.equal(calls[1]?.[0],"stage");
  assert.equal(calls[1]?.[1],"trusted-tenant");
  assert.equal(calls[1]?.[2],"trusted-staff");
  assert.equal((calls[1]?.[3] as { tenantId?: string }).tenantId,undefined);
  calls.length=0;
  assert.equal((await post(request({ action: "PUBLISH", variantCode: "STD", revisionNo: 1, confirmed: true }),ctx)).status,200);
  assert.deepEqual(calls,[["auth","product.spec.publish"],
    ["publish","trusted-tenant","trusted-staff","SKU-1","STD",1]]);
});
