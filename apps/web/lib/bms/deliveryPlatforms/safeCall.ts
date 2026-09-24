import type { AdapterResult } from "./types";

const DEFAULT_TIMEOUT_MS = 10_000;

export function boundedTimeoutMs(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(parsed), 1_000), 30_000);
}

export async function runDeliveryCall<T>(
  operation: (signal: AbortSignal) => Promise<AdapterResult<T>>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<AdapterResult<T>> {
  const controller = new AbortController();
  const bounded = boundedTimeoutMs(timeoutMs);
  const timer = setTimeout(() => controller.abort(), bounded);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, code: "TIMEOUT", retryable: true, detail: `Provider call timed out after ${bounded}ms` };
    }
    // Fetch/runtime errors may echo request URLs or headers supplied by a
    // third-party client. Keep durable health, command and event rows useful
    // without ever copying credentials or bearer tokens into them.
    return { ok: false, code: "PROVIDER_ERROR", retryable: true, detail: "Provider request failed" };
  } finally {
    clearTimeout(timer);
  }
}

export function providerHttpFailure(status: number): AdapterResult<never> {
  if (status === 401 || status === 403) {
    return { ok: false, code: "AUTH_FAILED", retryable: false, detail: `Provider authentication failed (${status})`, httpStatus: status };
  }
  if (status === 429) {
    return { ok: false, code: "RATE_LIMITED", retryable: true, detail: "Provider rate limit exceeded", httpStatus: status };
  }
  return {
    ok: false,
    code: "PROVIDER_ERROR",
    retryable: status >= 500,
    detail: `Provider returned HTTP ${status}`,
    httpStatus: status,
  };
}
