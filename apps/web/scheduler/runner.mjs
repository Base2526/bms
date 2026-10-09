import { randomUUID } from "node:crypto";
import { diagnoseError, httpHint, knownDiagnosticCode, summarizeResult } from "./diagnostics.mjs";

const QUARTER_HOUR = 15 * 60_000;
const DAY = 24 * 60 * 60_000;

export function readConfig(env) {
  const secret = env.BMS_CRON_SECRET?.trim();
  if (!secret) throw new Error("BMS_CRON_SECRET is required");
  if (!env.REDIS_URL?.trim()) throw new Error("REDIS_URL is required");
  let origin;
  try {
    const url = new URL(env.BMS_SCHEDULER_BASE_URL || "http://web:3000");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) throw new Error();
    origin = url.origin;
  } catch {
    throw new Error("BMS_SCHEDULER_BASE_URL must be an HTTP(S) origin without credentials");
  }
  return { origin, secret };
}

// Only the latest period is eligible after downtime; never replay a backlog.
export function slotFor(job, now) {
  if (job.group === "frequent") return Math.floor(now / QUARTER_HOUR) * QUARTER_HOUR;
  const todayAt20 = Math.floor(now / DAY) * DAY + 20 * 60 * 60_000;
  return now >= todayAt20 ? todayAt20 : todayAt20 - DAY;
}

// One atomic claim for both the UTC slot and the in-flight request. Hash tags keep
// the keys in one Redis Cluster slot. A failed/unknown attempt still consumes its slot.
export const CLAIM = `
if redis.call('EXISTS', KEYS[1]) == 1 or redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[3])
return 1`;
export const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

export function redisClaims(redis, origin) {
  // Do not namespace by container/replica: every scheduler for this Web must share claims.
  const scope = Buffer.from(origin).toString("base64url");
  const lockKey = (job) => `scheduler:{${scope}:${job.name}}:inflight`;
  return {
    async claim(job, slot, token, timeoutMs) {
      return Number(await redis.eval(CLAIM, 2,
        `scheduler:{${scope}:${job.name}}:slot:${slot}`, lockKey(job),
        token, 3 * DAY, timeoutMs + 120_000)) === 1;
    },
    async release(job, token) {
      await redis.eval(RELEASE, 1, lockKey(job), token);
    },
  };
}

class JobError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// Bound response size too: never print returned data, which may contain customer data.
async function readResult(response) {
  if (!response.body) throw new JobError("INVALID_RESPONSE");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_048_576) throw new JobError("RESPONSE_TOO_LARGE");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
    if (result.ok === false || result.error) throw new JobError("APPLICATION_ERROR");
    return result;
  } catch (error) {
    if (error instanceof JobError) throw error;
    throw new JobError("INVALID_RESPONSE");
  }
}

export async function executeJob(job, { config, claims, now = Date.now, fetcher = fetch,
  signal, log = (entry) => console.log(JSON.stringify(entry)), timeoutMs = job.group === "daily" ? 600_000 : 300_000 }) {
  if (signal?.aborted) return "stopped";
  const slot = slotFor(job, now());
  const token = randomUUID();
  const context = { job: job.name, route: job.path.split("?")[0], slot, runId: token, timeoutMs };
  try {
    if (!await claims.claim(job, slot, token, timeoutMs)) {
      log({ ...context, status: "skipped", stage: "claim", code: "SLOT_OR_LEASE_ALREADY_CLAIMED" });
      return "claimed";
    }
  } catch (error) {
    log({ ...context, status: "error", stage: "claim", code: "REDIS_CLAIM_FAILED", diagnostic: diagnoseError(error) });
    return "error"; // Fail closed: no request without a confirmed atomic claim.
  }
  const started = now();
  log({ ...context, status: "started", stage: "dispatch" });
  const requestSignal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  let knownComplete = false;
  let status = "success";
  let stage = "prepare";
  let requestId = null;
  let jobRunId = null;
  let httpStatus = null;
  let serverCode = null;
  let pagesCompleted = 0;
  let pageNumber = 0;
  let warnings = 0;
  try {
    let cursor = null;
    const seen = new Set();
    for (let page = 0; page < (job.paginated ? 100 : 1); page++) {
      pageNumber = page + 1;
      requestId = randomUUID();
      jobRunId = null; httpStatus = null; serverCode = null;
      requestSignal.throwIfAborted();
      const url = new URL(job.path, config.origin);
      if (url.origin !== config.origin || !url.pathname.startsWith("/api/bms/")) throw new JobError("INVALID_JOB_PATH");
      if (cursor) url.searchParams.set("afterTenant", cursor);
      knownComplete = false;
      stage = "http-request";
      const requestStarted = now();
      log({ ...context, requestId, page: pageNumber, status: "request-started", stage });
      const response = await fetcher(url, {
        method: "POST", headers: { "x-cron-secret": config.secret,
          "x-bms-scheduler-run-id": token, "x-bms-scheduler-request-id": requestId },
        redirect: "error", signal: requestSignal,
      });
      httpStatus = response.status;
      // Accept only bounded numeric IDs and known codes, never arbitrary response headers.
      const rawJobRunId = response.headers.get("x-bms-job-run-id");
      if (rawJobRunId && /^[1-9]\d{0,18}$/.test(rawJobRunId)) jobRunId = rawJobRunId;
      serverCode = knownDiagnosticCode(response.headers.get("x-bms-error-code"));
      stage = "http-response";
      if (!response.ok) {
        await response.body?.cancel();
        throw new JobError(`HTTP_${response.status}`);
      }
      stage = "parse-response";
      const result = await readResult(response);
      knownComplete = true;
      pagesCompleted++;
      const summary = summarizeResult(result);
      log({ ...context, requestId, jobRunId, page: pageNumber, status: "request-finished", stage,
        httpStatus, durationMs: now() - requestStarted, summary });
      if (summary.counters.failed > 0 || summary.failedResults > 0 || summary.counters.deadLettered > 0) {
        warnings++;
        log({ ...context, requestId, jobRunId, page: pageNumber, status: "warning", stage: "job-result",
          code: "JOB_RESULT_REQUIRES_ATTENTION", summary,
          hint: "HTTP completed but the job reported failed items; inspect this job's recorded result." });
      }
      stage = "pagination";
      if (!job.paginated || !result.nextTenant) break;
      cursor = result.nextTenant;
      if (typeof cursor !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(cursor) || seen.has(cursor)) {
        throw new JobError("INVALID_CURSOR");
      }
      seen.add(cursor);
      if (page === 99) throw new JobError("PAGE_LIMIT");
    }
  } catch (error) {
    status = "error";
    log({ ...context, requestId, jobRunId, page: pageNumber, pagesCompleted, httpStatus, status, stage,
      durationMs: now() - started, serverCode,
      code: error instanceof JobError ? error.code : requestSignal.aborted ? "REQUEST_ABORTED_UNKNOWN_OUTCOME" : "REQUEST_FAILED_UNKNOWN_OUTCOME",
      abortReason: requestSignal.aborted ? (signal?.aborted ? "shutdown" : "deadline") : null,
      diagnostic: diagnoseError(serverCode ? { code: serverCode } : error),
      ...(httpStatus && httpStatus >= 400 ? { hint: httpHint(httpStatus) } : {}) });
  } finally {
    // An interrupted HTTP request does not prove server work stopped. Keep the lease
    // until its TTL and never immediately retry the same slot after any failure.
    if (knownComplete) {
      try { await claims.release(job, token); }
      catch (error) {
        status = "error";
        log({ ...context, status, stage: "release", code: "REDIS_RELEASE_FAILED", diagnostic: diagnoseError(error) });
      }
    }
  }
  log({ ...context, requestId, jobRunId, status: "finished", outcome: status,
    pagesCompleted, httpStatus, warnings, durationMs: now() - started,
    lease: knownComplete ? "release-attempted" : "retained-until-expiry", retry: "next-slot-only" });
  return status;
}

export async function runCycle(jobs, options) {
  const pending = [...jobs];
  const results = [];
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (pending.length && !options.signal?.aborted) {
      const job = pending.shift();
      results.push({ name: job.name, status: await executeJob(job, options) });
    }
  }));
  return results;
}
