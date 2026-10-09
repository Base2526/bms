// Machine diagnostics only. Never copy arbitrary error messages, SQL, response bodies,
// URLs, headers, tenant cursors or the first (message-bearing) line of a stack.
const HINTS = {
  ENOTFOUND: "DNS lookup failed; check the service hostname and Docker network.",
  EAI_AGAIN: "DNS lookup timed out; check DNS availability.",
  ECONNREFUSED: "Connection refused; check the service port and readiness.",
  ECONNRESET: "Connection was reset; check upstream restarts and proxy logs.",
  ETIMEDOUT: "Connection timed out; check network reachability and upstream load.",
  EHOSTUNREACH: "Host is unreachable; check network routing.",
  ENETUNREACH: "Network is unreachable; check the container network.",
  UND_ERR_CONNECT_TIMEOUT: "HTTP connection timed out before completion.",
  UND_ERR_HEADERS_TIMEOUT: "Upstream did not return HTTP headers in time.",
  UND_ERR_BODY_TIMEOUT: "Upstream response body timed out.",
  UND_ERR_SOCKET: "HTTP socket closed; server work may still be running.",
  CERT_HAS_EXPIRED: "TLS certificate has expired.",
  DEPTH_ZERO_SELF_SIGNED_CERT: "TLS certificate is not trusted.",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "TLS certificate chain could not be verified.",
  ERR_TLS_CERT_ALTNAME_INVALID: "TLS certificate hostname does not match.",
  NOAUTH: "Redis requires authentication; check REDIS_URL credentials.",
  WRONGPASS: "Redis rejected the configured credentials.",
  READONLY: "Redis is a read-only replica; claims require a writable primary.",
  OOM: "Redis cannot accept writes; inspect memory and eviction policy.",
  CLUSTERDOWN: "Redis cluster is unavailable.",
  REDIS_COMMAND_TIMEOUT: "Redis command exceeded its deadline.",
  REDIS_NOT_READY: "Redis connection is not ready; waiting before dispatching jobs.",
  "28P01": "Database authentication failed.",
  "42501": "Database permission was denied.",
  "42P01": "Required database relation is missing; verify migrations.",
  "42703": "Required database column is missing; verify schema readiness.",
  "23505": "Database unique constraint rejected the write.",
  "23503": "Database foreign-key constraint rejected the write.",
  "23502": "A required database column was null.",
  "40001": "Database transaction serialization failed.",
  "40P01": "Database transaction deadlocked.",
  "53300": "Database connection capacity was exhausted.",
  "57P01": "Database connection was terminated by the server.",
  "57014": "Database statement was cancelled or timed out.",
  "08001": "Database connection could not be established.",
  "08006": "Database connection failed during the operation.",
  EACCES: "Filesystem access was denied.",
  ENOSPC: "Filesystem has no free space.",
  EROFS: "Filesystem is read-only.",
  UNKNOWN: "Inspect the matching Web job history and server frames using the trace identifiers.",
};

export const knownDiagnosticCode = (value) => typeof value === "string" && Object.hasOwn(HINTS, value) ? value : null;
export function diagnoseError(error) {
  const pending = [error]; const seen = new Set(); const causes = [];
  for (let n = 0; pending.length && n < 8; n++) {
    const current = pending.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    let code = knownDiagnosticCode(current.code);
    if (!code && typeof current.message === "string") {
      code = knownDiagnosticCode(current.message.match(/^(NOAUTH|WRONGPASS|READONLY|OOM|CLUSTERDOWN)\b/)?.[1]);
      if (current.message === "Command timed out") code = "REDIS_COMMAND_TIMEOUT";
      if (current.message.startsWith("Stream isn't writeable") || current.message === "Connection is closed.") code = "REDIS_NOT_READY";
    }
    if (code && !causes.includes(code)) causes.push(code);
    if (current.cause) pending.push(current.cause);
    if (Array.isArray(current.errors)) pending.push(...current.errors.slice(0, 4));
  }
  const code = causes[0] || "UNKNOWN";
  const frames = typeof error?.stack === "string" ? error.stack.split("\n").slice(1, 17)
    .filter((line) => /^\s+at\s/.test(line))
    .map((line) => line.match(/(?:\/|\\)([A-Za-z0-9_.-]{1,100}\.(?:[cm]?[jt]s|tsx):\d{1,7}:\d{1,5})\)?\s*$/)?.[1])
    .filter(Boolean).slice(0, 8) : [];
  return { code, causes, hint: HINTS[code], frames };
}

export function httpHint(status) {
  if (status === 401 || status === 403) return "Check that scheduler and Web use the same cron secret and authorization configuration.";
  if (status === 404 || status === 405) return "Check the Web release and the scheduled endpoint path/method.";
  if (status === 429) return "Upstream rate limit rejected this attempt; inspect service limits.";
  if (status === 502 || status === 504) return "Proxy could not complete the upstream request; server outcome may be unknown.";
  if (status === 503) return "Web is unavailable or the cron secret is unconfigured; inspect the correlated Web logs.";
  return "Inspect the correlated Web job history for the server-side cause.";
}

export function summarizeResult(result) {
  const counters = {};
  for (const key of ["scanned", "processed", "claimed", "sent", "skipped", "failed", "released",
    "expired", "retried", "actionRequired", "deadLettered", "deleted"]) {
    if (Number.isSafeInteger(result[key]) && result[key] >= 0) counters[key] = result[key];
  }
  const rows = Array.isArray(result.results) ? result.results.slice(0, 1000) : [];
  const failedResults = rows.filter((row) => row && typeof row === "object" &&
    (row.ok === false || row.error || ["ERROR", "PARTIAL"].includes(row.overallStatus))).length;
  return { counters, failedResults, resultsInspected: rows.length,
    resultsTruncated: Array.isArray(result.results) && result.results.length > 1000 };
}

// This map suppresses repeated informational log lines only; Redis still owns all
// authorization to dispatch. Bound by the finite job catalog, not by run count.
export function createEventLogger(write, instanceId) {
  const skipped = new Map();
  return (event) => {
    if (event.status === "skipped") {
      if (skipped.get(event.job) === event.slot) return;
      skipped.set(event.job, event.slot);
    }
    write({ at: new Date().toISOString(), component: "scheduler", instanceId, ...event });
  };
}
