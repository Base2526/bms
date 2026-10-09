import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { diagnoseError, createEventLogger } from "../apps/web/scheduler/diagnostics.mjs";
import { executeJob } from "../apps/web/scheduler/runner.mjs";
import * as traceModule from "../apps/web/lib/bms/scheduledJobTrace.ts";

const config = { origin: "http://web:3000", secret: "FAKE-secret" };
const job = { name: "release-expired", path: "/api/bms/orders/release-expired?minutes=30", group: "frequent" };
const claims = () => ({ claim: async () => true, release: async () => {} });
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const request = (runId = randomUUID(), requestId = randomUUID(), pathname = "/api/bms/orders/release-expired") =>
  new Request(config.origin + pathname, { headers: { "x-bms-scheduler-run-id": runId, "x-bms-scheduler-request-id": requestId } });

test("nested network and Redis causes become actionable diagnostics without private text", () => {
  const privateText = "FAKE password=secret person@example.com postgres://user:pass@host/db";
  const error = new Error(privateText, { cause: Object.assign(new Error(privateText), { code: "ECONNREFUSED" }) });
  error.stack = `${privateText}\n    at run (C:/Users/PRIVATE_PERSON/app/job.ts:42:8)\n    at ${privateText}`;
  const diagnostic = diagnoseError(error);
  assert.equal(diagnostic.code, "ECONNREFUSED");
  assert.deepEqual(diagnostic.frames, ["job.ts:42:8"]);
  assert.ok(!JSON.stringify(diagnostic).includes("PRIVATE_PERSON"));
  assert.ok(!JSON.stringify(diagnostic).includes(privateText));
  assert.equal(diagnoseError(new Error("WRONGPASS invalid username/password")).code, "WRONGPASS");
  assert.equal(diagnoseError(Object.assign(new Error(privateText), { code: privateText })).code, "UNKNOWN");
});

test("HTTP 500 captures shared trace IDs, DB job ID and SQLSTATE without copying its body", async () => {
  const events: any[] = []; let sent: Headers;
  assert.equal(await executeJob(job, { config, claims: claims(), log: (e: unknown) => events.push(e), fetcher: async (_url: URL, init: RequestInit) => {
    sent = new Headers(init.headers);
    return new Response("FAKE-private-body", { status: 500, headers: { "x-bms-job-run-id": "123", "x-bms-error-code": "42703" } });
  } }), "error");
  const failure = events.find((e) => e.status === "error");
  assert.equal(failure.runId, sent!.get("x-bms-scheduler-run-id"));
  assert.equal(failure.requestId, sent!.get("x-bms-scheduler-request-id"));
  assert.equal(failure.jobRunId, "123"); assert.equal(failure.serverCode, "42703");
  assert.equal(failure.stage, "http-response"); assert.equal(failure.diagnostic.code, "42703");
  assert.equal(events.at(-1).outcome, "error");
  assert.ok(!JSON.stringify(events).includes("FAKE-private-body"));
});

test("malicious response headers and DNS errors never leak credentials", async () => {
  const events: any[] = [];
  for (const fetcher of [
    async () => new Response("private", { status: 503, headers: { "x-bms-job-run-id": "FAKE-private", "x-bms-error-code": "FAKE-private" } }),
    async () => { throw new Error("FAKE-private", { cause: { code: "ENOTFOUND" } }); },
  ]) await executeJob(job, { config, claims: claims(), log: (e: unknown) => events.push(e), fetcher });
  assert.ok(events.some((e) => e.diagnostic?.code === "ENOTFOUND"));
  assert.ok(!JSON.stringify(events).includes("FAKE-private"));
});

test("lifecycle records success and pagination without logging tenant cursors or results", async () => {
  const events: any[] = []; let page = 0;
  const cursor = randomUUID();
  await executeJob({ ...job, paginated: true }, { config, claims: claims(), log: (e: unknown) => events.push(e), fetcher: async () => {
    page++; return new Response(JSON.stringify({ ok: true, nextTenant: page === 1 ? cursor : null, customer: "FAKE-private" }));
  } });
  const requests = events.filter((e) => e.status === "request-started");
  assert.equal(requests.length, 2); assert.notEqual(requests[0].requestId, requests[1].requestId);
  assert.equal(requests[0].runId, requests[1].runId); assert.equal(events.at(-1).pagesCompleted, 2);
  assert.ok(!JSON.stringify(events).includes(cursor)); assert.ok(!JSON.stringify(events).includes("FAKE-private"));
});

test("repeated slot skips are summarized but failures are always written", () => {
  const events: any[] = []; const log = createEventLogger((e: unknown) => events.push(e), "FAKE-instance");
  for (let i = 0; i < 20; i++) log({ job: "test", slot: 100, status: "skipped" });
  log({ job: "test", slot: 200, status: "skipped" });
  log({ job: "test", status: "error" }); log({ job: "test", status: "error" });
  assert.equal(events.length, 4); assert.equal(events[0].component, "scheduler");
});

test("HTTP success with failed domain items emits a warning using counts only", async () => {
  const events: any[] = [];
  await executeJob(job, { config, claims: claims(), log: (e: unknown) => events.push(e), fetcher: async () =>
    new Response(JSON.stringify({ ok: true, processed: 3, failed: 1,
      results: [{ ok: false, error: "FAKE-secret-provider-message", tenantId: "FAKE-tenant" }] })),
  });
  const warning = events.find((e) => e.code === "JOB_RESULT_REQUIRES_ATTENTION");
  assert.equal(warning.summary.counters.failed, 1); assert.equal(warning.summary.failedResults, 1);
  assert.equal(events.at(-1).warnings, 1);
  assert.ok(!JSON.stringify(events).includes("FAKE-secret-provider-message"));
  assert.ok(!JSON.stringify(events).includes("FAKE-tenant"));
});

test("request-local tracing isolates concurrent jobs and rejects untrusted trace shapes", async () => {
  const first = randomUUID(); const second = randomUUID();
  const values = await Promise.all([first, second].map((id) => traceModule.withScheduledJobTrace(request(id), async () => {
    await new Promise((resolve) => setTimeout(resolve, 2));
    assert.equal(traceModule.scheduledJobTrace()?.runId, id);
    return new Response("ok");
  })));
  assert.equal(values[0].headers.get("x-bms-scheduler-run-id"), first);
  assert.equal(values[1].headers.get("x-bms-scheduler-run-id"), second);
  assert.equal(traceModule.scheduledJobTrace(), undefined);
  for (const req of [request("invalid"), request(randomUUID(), randomUUID(), "/api/pos/sale")]) {
    await traceModule.withScheduledJobTrace(req, async () => {
      assert.equal(traceModule.scheduledJobTrace(), undefined); return new Response("ok");
    });
  }
});

function historyHarness(query: Function, saveSystemLog: Function = async () => true) {
  const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
  const ts = require("typescript"); const exports: any = {}; const events: any[] = []; const systemLogs: any[] = [];
  const modules: any = { "@/lib/db": { query }, "./scheduledJobTrace": traceModule,
    "../../scheduler/diagnostics.mjs": { diagnoseError },
    "@/lib/log/writeLog.server": { writeLogServer: async (...args: unknown[]) => { systemLogs.push(args); return saveSystemLog(); } } };
  const compiled = ts.transpileModule(read("apps/web/lib/bms/jobRuns.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const log = (value: string) => events.push(JSON.parse(value));
  new Function("require", "exports", "console", compiled)((id: string) => {
    assert.ok(id in modules, `Unexpected dependency ${id}`); return modules[id];
  }, exports, { log, error: log });
  return { ...exports, events, systemLogs };
}

test("backend persists trace metadata and emits matching job ID without changing business output", async () => {
  const queries: any[] = [];
  const h = historyHarness(async (sql: string, args: unknown[]) => { queries.push([sql, args]); return { rows: [{ id: 42 }] }; });
  const runId = randomUUID(); const result = { processed: 3 };
  const response = await traceModule.withScheduledJobTrace(request(runId), async () => {
    assert.equal(await h.recordJobRun("release-expired", "cron", async () => result), result);
    return new Response("ok");
  });
  assert.equal(response.headers.get("x-bms-job-run-id"), "42");
  const output = JSON.parse(queries[1][1][2]);
  assert.deepEqual(output.result, result); assert.equal(output.scheduler.runId, runId);
  assert.equal(h.events.at(-1).status, "success");
});

test("caught backend failure reaches history, system_logs and a safe response code", async () => {
  const queries: any[] = [];
  const h = historyHarness(async (sql: string, args: unknown[]) => { queries.push([sql, args]); return { rows: [{ id: 43 }] }; });
  const error = Object.assign(new Error("FAKE original database message"), { code: "42703" });
  const response = await traceModule.withScheduledJobTrace(request(), async () => {
    await assert.rejects(h.recordJobRun("release-expired", "cron", async () => { throw error; }), (err) => err === error);
    return new Response("caught by route", { status: 500 });
  });
  assert.equal(response.headers.get("x-bms-error-code"), "42703");
  assert.equal(JSON.parse(queries[1][1][3]).stage, "execute");
  assert.equal(h.systemLogs.length, 1); assert.equal(h.systemLogs[0][3].diagnostic.code, "42703");
  assert.ok(!JSON.stringify(h.events).includes(error.message));
  assert.ok(!JSON.stringify(h.systemLogs).includes(error.message));
});

test("DB outage during history insert or error recording does not hide the first failure", async () => {
  const original = Object.assign(new Error("FAKE first failure"), { code: "42703" });
  for (const failInsert of [true, false]) {
    const h = historyHarness(async (sql: string) => {
      if (sql.includes("INSERT") && !failInsert) return { rows: [{ id: 44 }] };
      throw failInsert ? original : Object.assign(new Error("FAKE recording failure"), { code: "ECONNREFUSED" });
    });
    await traceModule.withScheduledJobTrace(request(), async () => {
      await assert.rejects(h.recordJobRun("release-expired", "cron", async () => { throw original; }), (err) => err === original);
      return new Response("error", { status: 500 });
    });
    assert.equal(h.events.find((e: any) => e.status === "error").stage, failInsert ? "record-start" : "execute");
    if (!failInsert) assert.equal(h.events.at(-1).stage, "record-error");
  }
});

test("manual jobs keep the existing result shape in history", async () => {
  const queries: any[] = [];
  const h = historyHarness(async (sql: string, args: unknown[]) => { queries.push([sql, args]); return { rows: [{ id: 45 }] }; });
  await h.recordJobRun("test", "manual", async () => [1, 2]);
  assert.deepEqual(JSON.parse(queries[1][1][2]), [1, 2]); assert.equal(h.events.length, 0);
});

test("system-log persistence failure is visible without replacing the job exception", async () => {
  const original = Object.assign(new Error("FAKE original private message"), { code: "42703" });
  const h = historyHarness(async () => ({ rows: [{ id: 46 }] }), async () => false);
  await traceModule.withScheduledJobTrace(request(), async () => {
    await assert.rejects(h.recordJobRun("release-expired", "cron", async () => { throw original; }), (err) => err === original);
    return new Response("error", { status: 500 });
  });
  assert.ok(h.events.some((e: any) => e.code === "SYSTEM_LOG_WRITE_FAILED"));
  assert.ok(!JSON.stringify(h.events).includes(original.message));
});
