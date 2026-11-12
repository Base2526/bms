import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { POST } from "../apps/web/app/api/bms/jobs/etax/route.ts";

const route = path.resolve(import.meta.dirname, "../apps/web/app/api/bms/jobs/etax/route.ts");
const request = (headers: Record<string, string> = {}) =>
  new Request("https://bms.example.test/api/bms/jobs/etax", { method: "POST", headers });
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");

test("e-Tax cron refuses missing configuration, wrong secret and legacy job tokens", async () => {
  const oldCron = process.env.BMS_CRON_SECRET;
  const oldJob = process.env.BMS_JOB_TOKEN;
  const oldEnabled = process.env.ETAX_ENABLED;
  try {
    delete process.env.BMS_CRON_SECRET;
    process.env.BMS_JOB_TOKEN = "legacy-secret";
    process.env.ETAX_ENABLED = "false";
    assert.equal((await POST(request({ "x-job-token": "legacy-secret" }) as never)).status, 503);
    process.env.BMS_CRON_SECRET = "current-secret";
    assert.equal((await POST(request({ "x-job-token": "legacy-secret" }) as never)).status, 401);
    assert.equal((await POST(request({ "x-cron-secret": "wrong" }) as never)).status, 401);
    const disabled = await POST(request({ "x-cron-secret": "current-secret" }) as never);
    assert.equal(disabled.status, 200);
    assert.deepEqual(await disabled.json(), { skipped: "ETAX_ENABLED ปิดอยู่" });
  } finally {
    if (oldCron === undefined) delete process.env.BMS_CRON_SECRET;
    else process.env.BMS_CRON_SECRET = oldCron;
    if (oldJob === undefined) delete process.env.BMS_JOB_TOKEN;
    else process.env.BMS_JOB_TOKEN = oldJob;
    if (oldEnabled === undefined) delete process.env.ETAX_ENABLED;
    else process.env.ETAX_ENABLED = oldEnabled;
  }
});

test("enabled e-Tax runs are recorded under the operations schedule key", () => {
  const source = readFileSync(route, "utf8");
  assert.match(source, /recordJobRun\("etax", "cron",/);
  assert.doesNotMatch(source, /process\.env\.BMS_JOB_TOKEN|req\.headers\.get\("x-job-token"\)/);
  const schedule = readFileSync(path.resolve(import.meta.dirname, "../apps/web/lib/bms/operationsSchedule.ts"), "utf8");
  assert.match(schedule, /key: "etax"[\s\S]*?sourcePath: "apps\/web\/app\/api\/bms\/jobs\/etax\/route\.ts"/);
});

test("one tenant failure does not skip others or mark the e-Tax job successful", async () => {
  const processed: string[] = [];
  const statuses: string[] = [];
  const mocks: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, options?: { status?: number }) =>
      ({ body, status: options?.status ?? 200 }) } },
    "@/lib/db": { query: async () => ({ rowCount: 2, rows: [{ tenant_id: "a" }, { tenant_id: "b" }] }) },
    "@/lib/bms/etax/queue": { processEtaxQueue: async (tenantId: string) => {
      processed.push(tenantId);
      if (tenantId === "a") throw new Error("provider detail must not escape");
      return { processed: 1, accepted: 1, failed: 0, rejected: 0 };
    } },
    "@/lib/bms/etax/providers": { etaxEnabledGlobally: () => true },
    "@/lib/bms/cronRouteAuth": { authorizeCronRequest: () => ({ ok: true }) },
    "@/lib/bms/jobRuns": { recordJobRun: async (_name: string, _source: string, run: () => Promise<unknown>) => {
      try { const output = await run(); statuses.push("success"); return output; }
      catch (error) { statuses.push("error"); throw error; }
    } },
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, run: (req: Request) => Promise<unknown>) =>
      async (req: Request) => {
        try { return await run(req); }
        catch (error) { return { status: 500, error: String(error) }; }
      } },
  };
  const module = { exports: {} as Record<string, any> };
  const source = ts.transpileModule(readFileSync(route, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", source)((name: string) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, module, module.exports);
  const result = await module.exports.POST(request());
  assert.deepEqual(processed, ["a", "b"]);
  assert.deepEqual(statuses, ["error"]);
  assert.equal(result.status, 500);
  assert.match(result.error, /ETAX_TENANT_FAILURE:1/);
  assert.doesNotMatch(result.error, /provider detail/);
});
