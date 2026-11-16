import { performance } from "node:perf_hooks";

export type TimedResponse = {
  response: Response;
  durationMs: number;
  text: string;
  graphql: boolean;
};

/** Include response transfer in latency and abort slow requests instead of leaving work behind. */
export async function timedFetch(input: string, init: RequestInit, timeoutMs: number): Promise<TimedResponse> {
  const started = performance.now();
  const response = await fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  return {
    response, text, durationMs: performance.now() - started,
    graphql: new URL(input).pathname === "/api/graphql",
  };
}

export function toRequestResult(result: TimedResponse): {
  ok: boolean; status: number; durationMs: number; error?: string;
} {
  let graphqlError: string | undefined;
  if (result.graphql && result.response.ok) {
    let payload: unknown;
    try { payload = JSON.parse(result.text); } catch { graphqlError = "invalid GraphQL JSON"; }
    if (!graphqlError) {
      const body = payload as { data?: unknown; errors?: unknown } | null;
      if (body && typeof body === "object" && "errors" in body &&
          (!Array.isArray(body.errors) || body.errors.length))
        graphqlError = "GraphQL errors";
      else if (!body || typeof body !== "object" || !body.data || typeof body.data !== "object" ||
          Array.isArray(body.data) || !Object.keys(body.data).length)
        graphqlError = "missing GraphQL data";
    }
  }
  const ok = result.response.ok && !graphqlError;
  return {
    ok, status: result.response.status, durationMs: result.durationMs,
    error: ok ? undefined : (graphqlError ? `${graphqlError}: ${truncate(result.text, 160)}` : truncate(result.text, 160)),
  };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
