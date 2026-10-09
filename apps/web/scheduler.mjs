import { readFile, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readConfig, redisClaims, runCycle } from "./scheduler/runner.mjs";
import { createEventLogger, diagnoseError } from "./scheduler/diagnostics.mjs";

const healthPath = path.join(tmpdir(), "bms-scheduler-health.json");
if (process.argv.includes("--healthcheck")) {
  try {
    const health = JSON.parse(await readFile(healthPath, "utf8"));
    process.exit(health.ok && Date.now() - health.at < 45_000 ? 0 : 1);
  } catch { process.exit(1); }
}

const log = createEventLogger((entry) => console.log(JSON.stringify(entry)), randomUUID());
let config;
try { config = readConfig(process.env); }
catch (error) { log({ status: "fatal", code: "CONFIG_INVALID", message: error.message }); process.exit(1); }

const jobs = JSON.parse(await readFile(new URL("./scheduler/jobs.json", import.meta.url), "utf8"));
// Reuse the established Redis client; this separate process needs no DB credentials.
const { sharedRedisClient: redis } = await import("./lib/cache.ts");
redis.options.enableOfflineQueue = false;
redis.options.commandTimeout = 5_000;
redis.options.maxRetriesPerRequest = 0;
redis.removeAllListeners("error");
redis.on("error", () => {}); // Readiness below records the bounded cause on transitions.
const controller = new AbortController();
const failures = new Set();
let heartbeatRunning = false;
let ready = false;
let lastDependencyState = "";
let lastDependencyLog = 0;
async function heartbeat() {
  if (heartbeatRunning) return;
  heartbeatRunning = true;
  try {
    let redisOk = false;
    let redisDiagnostic = null;
    try { redisOk = await redis.ping() === "PONG"; } catch (error) { redisDiagnostic = diagnoseError(error); }
    let webOk = false;
    let webDiagnostic = null;
    let webStatus = null;
    try {
      // Same readiness surface as Retail Local. No job or credential is sent here.
      const response = await fetch(new URL("/admin/login", config.origin), {
        method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(5_000),
      });
      webOk = response.status >= 200 && response.status < 400;
      webStatus = response.status;
      await response.body?.cancel();
    } catch (error) { webDiagnostic = diagnoseError(error); }
    ready = redisOk && webOk;
    const dependencyState = JSON.stringify({ redisOk, webOk, webStatus,
      redisCode: redisDiagnostic?.code, webCode: webDiagnostic?.code });
    if (dependencyState !== lastDependencyState || (!ready && Date.now() - lastDependencyLog >= 60_000)) {
      log({ status: ready ? "ready" : "waiting", stage: "readiness", redisOk, webOk, httpStatus: webStatus,
        redisDiagnostic, webDiagnostic });
      lastDependencyState = dependencyState; lastDependencyLog = Date.now();
    }
    const state = { at: Date.now(), ok: ready && !controller.signal.aborted && failures.size === 0,
      redisOk, webOk, failedJobs: [...failures], redisDiagnostic, webDiagnostic, httpStatus: webStatus };
    await writeFile(`${healthPath}.tmp`, JSON.stringify(state));
    await rename(`${healthPath}.tmp`, healthPath);
  } catch (error) { log({ status: "error", stage: "health-write", code: "HEALTH_WRITE_FAILED", diagnostic: diagnoseError(error) }); }
  finally { heartbeatRunning = false; }
}
redis.connect().catch(() => {}); // Reconnection is handled by the shared client.
const healthTimer = setInterval(heartbeat, 10_000);
await heartbeat();
const stop = () => { controller.abort(); };
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
log({ status: "started", jobs: jobs.length, frequent: "every 15 minutes UTC", daily: "20:00 UTC" });
try {
  while (!controller.signal.aborted) {
    const results = ready
      ? await runCycle(jobs, { config, claims: redisClaims(redis, config.origin), signal: controller.signal, log })
      : [];
    for (const result of results) {
      if (result.status === "error") failures.add(result.name);
      else if (result.status === "success") failures.delete(result.name);
    }
    await heartbeat();
    if (!controller.signal.aborted) await new Promise((resolve) => {
      const done = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", done); resolve(); };
      const timer = setTimeout(done, 10_000);
      controller.signal.addEventListener("abort", done, { once: true });
    });
  }
} finally {
  clearInterval(healthTimer);
  await heartbeat();
  redis.disconnect();
  log({ status: "stopped" });
}
