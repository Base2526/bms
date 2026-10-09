import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { executeJob, readConfig, redisClaims, runCycle, slotFor, CLAIM, RELEASE } from "../apps/web/scheduler/runner.mjs";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const jobs = JSON.parse(read("apps/web/scheduler/jobs.json"));
const config = { origin: "http://web:3000", secret: "FAKE-test-only" };
const job = jobs[0];
const instant = Date.parse("2026-10-09T20:00:00Z");
const now = () => instant;
const ok = (body: unknown = { ok: true }) => new Response(JSON.stringify(body));
function memoryClaims() {
  const slots = new Set<string>();
  const locks = new Map<string, string>();
  return {
    slots, locks,
    async claim(j: typeof job, slot: number, token: string) {
      const key = `${j.name}:${slot}`;
      if (slots.has(key) || locks.has(j.name)) return false;
      slots.add(key); locks.set(j.name, token); return true;
    },
    async release(j: typeof job, token: string) { if (locks.get(j.name) === token) locks.delete(j.name); },
  };
}

test("configuration fails closed without credentials and rejects invalid origins", () => {
  assert.throws(() => readConfig({}), /BMS_CRON_SECRET/);
  assert.throws(() => readConfig({ BMS_CRON_SECRET: "FAKE" }), /REDIS_URL/);
  for (const origin of ["file:///tmp", "http://user:password@web", "http://web/path", "http://web?x=1", "invalid"]) {
    assert.throws(() => readConfig({ BMS_CRON_SECRET: "FAKE", REDIS_URL: "redis://redis", BMS_SCHEDULER_BASE_URL: origin }), /HTTP/);
  }
  assert.deepEqual(readConfig({ BMS_CRON_SECRET: config.secret, REDIS_URL: "redis://redis" }), config);
});

test("UTC slots handle the daily boundary and recover only the latest slot after downtime", () => {
  const daily = jobs.find((j: typeof job) => j.group === "daily");
  assert.equal(slotFor(daily, instant - 1), instant - 86400000);
  assert.equal(slotFor(daily, instant), instant);
  assert.equal(slotFor(job, instant + 14 * 60000), instant);
  assert.equal(slotFor(job, instant + 15 * 60000), instant + 15 * 60000);
  assert.equal(slotFor(daily, instant + 10 * 86400000), instant + 10 * 86400000);
});

test("all 17 schedules match the existing workflow and use real guarded routes", () => {
  const workflow = read(".github/workflows/bms-cron.yml");
  const entries = [...workflow.matchAll(/- name: ([\w-]+)\s+path: (\/api\/\S+)/g)];
  assert.equal(jobs.length, 17);
  assert.deepEqual(jobs.map((j: typeof job) => [j.name, j.path]).sort(), entries.map((m) => [m[1], m[2]]).sort());
  assert.equal(new Set(jobs.map((j: typeof job) => j.name)).size, 17);
  const dailyStart = workflow.indexOf("  daily:");
  for (const j of jobs) {
    assert.equal(j.group, workflow.indexOf(`- name: ${j.name}\n`) > dailyStart ? "daily" : "frequent");
    assert.match(read(`apps/web/app${j.path.split("?")[0]}/route.ts`), /authorizeCronRequest/);
    assert.match(read(`apps/web/app${j.path.split("?")[0]}/route.ts`), /withRouteErrorLog/);
  }
});

test("two runners and a restarted runner send just one request for a shared slot", async () => {
  const claims = memoryClaims(); let calls = 0;
  const options = { config, claims, now, fetcher: async () => { calls++; return ok(); }, log: () => {} };
  const outcomes = await Promise.all([executeJob(job, options), executeJob(job, options)]);
  assert.deepEqual(outcomes.sort(), ["claimed", "success"]);
  assert.equal(await executeJob(job, { ...options }), "claimed");
  assert.equal(calls, 1);
  assert.equal(await executeJob(job, { ...options, now: () => instant + 900000 }), "success");
});

test("Redis failure never sends an HTTP request or prints credential errors", async () => {
  const logs: unknown[] = [];
  const result = await executeJob(job, { config, now, claims: { claim: async () => { throw new Error(config.secret); } },
    fetcher: async () => { assert.fail("must not run"); }, log: (entry: unknown) => logs.push(entry) });
  assert.equal(result, "error");
  assert.match(JSON.stringify(logs), /REDIS_CLAIM_FAILED/);
  assert.ok(!JSON.stringify(logs).includes(config.secret));
});

test("HTTP request keeps auth on the configured origin and refuses redirects", async () => {
  await executeJob(job, { config, now, claims: memoryClaims(), log: () => {}, fetcher: async (url: URL, init: RequestInit) => {
    assert.equal(url.href, config.origin + job.path);
    assert.equal(init.method, "POST"); assert.equal(init.redirect, "error");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("x-cron-secret"), config.secret);
    assert.match(headers.get("x-bms-scheduler-run-id")!, /^[0-9a-f-]{36}$/);
    assert.match(headers.get("x-bms-scheduler-request-id")!, /^[0-9a-f-]{36}$/);
    return ok();
  } });
  let calls = 0;
  assert.equal(await executeJob({ ...job, path: "https://outside.invalid/api/bms/job" }, {
    config, now, claims: memoryClaims(), log: () => {}, fetcher: async () => { calls++; return ok(); },
  }), "error");
  assert.equal(calls, 0);
});

test("HTTP errors, malformed responses and application failures do not retry the same slot", async () => {
  for (const response of [new Response("FAKE private body", { status: 503 }), new Response("bad JSON"), ok({ ok: false, error: "FAKE private body" })]) {
    const claims = memoryClaims(); const logs: unknown[] = []; let calls = 0;
    const options = { config, now, claims, fetcher: async () => { calls++; return response; }, log: (entry: unknown) => logs.push(entry) };
    assert.equal(await executeJob(job, options), "error");
    assert.equal(await executeJob(job, options), "claimed"); assert.equal(calls, 1);
    assert.ok(!JSON.stringify(logs).includes("FAKE private body"));
  }
});

test("unknown network outcome retains its in-flight claim across the next time slot", async () => {
  const claims = memoryClaims();
  const options = { config, now, claims, log: () => {}, fetcher: async () => { throw new Error("connection lost"); } };
  assert.equal(await executeJob(job, options), "error");
  assert.equal(claims.locks.has(job.name), true);
  assert.equal(await executeJob(job, { ...options, now: () => instant + 900000 }), "claimed");
});

test("shutdown aborts an in-flight request and starts no new job", async () => {
  const controller = new AbortController(); const claims = memoryClaims();
  const options = { config, now, claims, signal: controller.signal, log: () => {},
    fetcher: async (_url: URL, init: RequestInit) => { controller.abort(); init.signal!.throwIfAborted(); return ok(); } };
  assert.equal(await executeJob(job, options), "error");
  assert.equal(await executeJob(jobs[1], options), "stopped"); assert.equal(claims.slots.size, 1);
});

test("request deadline aborts HTTP, retains its lease and reports an unknown outcome", async () => {
  const claims = memoryClaims(); const logs: unknown[] = [];
  // AbortSignal.timeout is unref'd: keep this unit test alive until the signal fires.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const result = await executeJob(job, { config, now, claims, timeoutMs: 15,
      log: (entry: unknown) => logs.push(entry), fetcher: async (_url: URL, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true })),
    });
    assert.equal(result, "error"); assert.equal(claims.locks.has(job.name), true);
    assert.match(JSON.stringify(logs), /REQUEST_ABORTED_UNKNOWN_OUTCOME/);
  } finally { clearTimeout(keepAlive); }
});

test("retention follows every tenant cursor under the same job claim", async () => {
  const retention = jobs.find((j: typeof job) => j.paginated);
  const cursor = "00000000-0000-4000-8000-000000000001"; const urls: URL[] = [];
  assert.equal(await executeJob(retention, { config, now, claims: memoryClaims(), log: () => {}, fetcher: async (url: URL) => {
    urls.push(url); return ok({ ok: true, nextTenant: urls.length === 1 ? cursor : null });
  } }), "success");
  assert.equal(urls.length, 2); assert.equal(urls[1].searchParams.get("afterTenant"), cursor);
});

test("retention rejects repeated or malformed cursors and bounds response size", async () => {
  const retention = jobs.find((j: typeof job) => j.paginated);
  for (const cursor of ["invalid", "00000000-0000-4000-8000-000000000001"]) {
    let calls = 0;
    assert.equal(await executeJob(retention, { config, now, claims: memoryClaims(), log: () => {}, fetcher: async () => {
      calls++; return ok({ ok: true, nextTenant: cursor });
    } }), "error"); assert.ok(calls <= 2);
  }
  assert.equal(await executeJob(job, { config, now, claims: memoryClaims(), log: () => {}, fetcher: async () => new Response("x".repeat(1_048_577)) }), "error");
});

test("retention stops visibly at the maximum page count", async () => {
  let pages = 0; const logs: unknown[] = [];
  assert.equal(await executeJob(jobs.find((j: typeof job) => j.paginated), {
    config, now, claims: memoryClaims(), log: (entry: unknown) => logs.push(entry), fetcher: async () => {
      pages++; return ok({ nextTenant: `00000000-0000-4000-8000-${String(pages).padStart(12, "0")}` });
    },
  }), "error");
  assert.equal(pages, 100); assert.match(JSON.stringify(logs), /PAGE_LIMIT/);
});

test("cycles bound concurrency to three and continue independent jobs after a failure", async () => {
  let active = 0; let peak = 0;
  const results = await runCycle(jobs, { config, now, claims: memoryClaims(), log: () => {}, fetcher: async (url: URL) => {
    active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 1)); active--;
    return url.pathname.includes("followups") ? new Response("failed", { status: 500 }) : ok();
  } });
  assert.equal(peak, 3); assert.equal(results.filter((r) => r.status === "success").length, 16);
  assert.equal(results.filter((r) => r.status === "error").length, 1);
});

test("Redis adapter claims atomically and owner-checks release in the same cluster slot", async () => {
  const calls: unknown[][] = [];
  const claims = redisClaims({ eval: async (...args: unknown[]) => { calls.push(args); return 1; } }, config.origin);
  assert.equal(await claims.claim(job, instant, "owner", 300000), true); await claims.release(job, "owner");
  assert.equal(calls[0][0], CLAIM); assert.equal(calls[1][0], RELEASE); assert.equal(calls[0][1], 2);
  assert.equal(String(calls[0][2]).match(/\{.*\}/)![0], String(calls[0][3]).match(/\{.*\}/)![0]);
  assert.equal(calls[1][2], calls[0][3]); assert.match(RELEASE, /GET.*ARGV\[1\]/);
});

test("deployment opts in without database credentials or automatic GitHub duplicates", () => {
  const compose = read("docker-compose.yml");
  const scheduler = compose.slice(compose.indexOf("  scheduler:"), compose.indexOf("  postgres:"));
  assert.match(scheduler, /profiles: \["scheduler"\]/); assert.match(scheduler, /target: scheduler/);
  assert.match(scheduler, /--healthcheck/);
  assert.doesNotMatch(scheduler, /POSTGRES_|DATABASE_URL|ANTHROPIC|\/var\/run\/docker/);
  for (const filename of ["docker-compose.yml", "docker-compose.dev.yml", "docker-compose.prod.yml"]) {
    assert.match(read(filename), /BMS_SCHEDULER_BASE_URL/);
  }
  const workflow = read(".github/workflows/bms-cron.yml");
  assert.equal((workflow.match(/vars.BMS_CRON_RUNNER == 'github'/g) || []).length, 2);
  assert.equal((workflow.match(/vars.BMS_CRON_RUNNER != 'docker'/g) || []).length, 2);
});
