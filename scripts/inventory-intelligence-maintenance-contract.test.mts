import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../apps/web/app/api/bms/inventory-intelligence/maintain/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function route(options: { failed?: number; denied?: boolean } = {}) {
  const states: string[] = [], calls: any[] = [];
  const deps: Record<string, any> = {
    "next/server": { NextResponse: { json: (body: any, init?: any) => ({ body, status: init?.status ?? 200 }) } },
    "@/lib/bms/cronRouteAuth": { authorizeCronRequest: () => options.denied ? { ok: false, response: { status: 401 } } : { ok: true } },
    "@/lib/bms/inventoryIntelligence": { runInventoryForecastMaintenancePage: async (...args: any[]) => {
      calls.push(args); return { processed: 2, failed: options.failed ?? 0, nextTenant: null };
    } },
    "@/lib/bms/jobRuns": { recordJobRun: async (_name: string, _trigger: string, work: () => Promise<any>) => {
      try { const result = await work(); states.push("success"); return result; }
      catch (e) { states.push("error"); throw e; }
    } },
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: any) => handler },
  };
  const module = { exports: {} as any };
  new Function("require", "module", "exports", compiled)((name: string) => { assert.ok(name in deps); return deps[name]; }, module, module.exports);
  return { states, calls, run: (query = "") => module.exports.POST({ nextUrl: new URL(`http://localhost/api/bms/inventory-intelligence/maintain${query}`) }) };
}

test("maintenance rejects unauthorized requests before starting work", async () => {
  const h = route({ denied: true });
  assert.equal((await h.run()).status, 401);
  assert.deepEqual(h.calls, []);
});
test("maintenance rejects a malformed pagination cursor", async () => {
  const h = route();
  assert.equal((await h.run("?afterTenant=invalid")).status, 400);
  assert.deepEqual(h.calls, []);
});
test("maintenance records failure and returns non-success when one tenant fails", async () => {
  const h = route({ failed: 1 });
  const response = await h.run();
  assert.equal(response.status, 500);
  assert.equal(response.body.ok, false);
  assert.deepEqual(h.states, ["error"]);
});
test("successful maintenance preserves the page cursor and bounded tenant batch", async () => {
  const h = route();
  const cursor = "11111111-1111-4111-8111-111111111111";
  const response = await h.run(`?afterTenant=${cursor}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.deepEqual(h.states, ["success"]);
  assert.deepEqual(h.calls, [[cursor,25]]);
});
