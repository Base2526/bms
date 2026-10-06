const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;
const MIN_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_REQUEST_TIMEOUT_MS = 60 * 60 * 1000;

export function webRequestTimeoutMs(rawValue = process.env.BMS_HTTP_REQUEST_TIMEOUT_MS) {
  const value = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!value) return DEFAULT_REQUEST_TIMEOUT_MS;

  if (!/^\d+$/.test(value)) {
    throw new Error("BMS_HTTP_REQUEST_TIMEOUT_MS must be an integer number of milliseconds");
  }

  const timeoutMs = Number(value);
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs < MIN_REQUEST_TIMEOUT_MS
    || timeoutMs > MAX_REQUEST_TIMEOUT_MS
  ) {
    throw new Error(
      `BMS_HTTP_REQUEST_TIMEOUT_MS must be between ${MIN_REQUEST_TIMEOUT_MS} and ${MAX_REQUEST_TIMEOUT_MS}`,
    );
  }

  return timeoutMs;
}

export function configureWebHttpServer(server, rawRequestTimeoutMs) {
  const requestTimeoutMs = webRequestTimeoutMs(rawRequestTimeoutMs);

  // Node's default requestTimeout is five minutes. That is a total-body deadline,
  // so a healthy multi-gigabyte streaming upload can be cut off while bytes are
  // still arriving. The upload handlers retain their separate two-minute idle
  // deadline and continue to abort genuinely stalled connections.
  server.requestTimeout = requestTimeoutMs;
  server.headersTimeout = 60 * 1000;
  server.keepAliveTimeout = 5 * 1000;

  return {
    requestTimeoutMs,
    headersTimeoutMs: server.headersTimeout,
    keepAliveTimeoutMs: server.keepAliveTimeout,
  };
}

