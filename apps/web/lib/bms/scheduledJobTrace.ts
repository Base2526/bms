import { AsyncLocalStorage } from "node:async_hooks";
import jobs from "../../scheduler/jobs.json";
import { knownDiagnosticCode } from "../../scheduler/diagnostics.mjs";

type Trace = { runId: string; requestId: string; route: string; jobRunId?: number; errorCode?: string };
const traces = new AsyncLocalStorage<Trace>();
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const paths = new Set(jobs.map((job) => job.path.split("?")[0]));
export const scheduledJobTrace = () => traces.getStore();

// Trace headers provide correlation only, never authentication/authorization. Each
// existing handler still validates its cron secret before executing any job.
export async function withScheduledJobTrace(request: unknown, execute: () => Promise<Response>): Promise<Response> {
  const req = request as Request | undefined;
  const runId = req?.headers?.get?.("x-bms-scheduler-run-id");
  const requestId = req?.headers?.get?.("x-bms-scheduler-request-id");
  if (!runId || !requestId || !UUID.test(runId) || !UUID.test(requestId)) return execute();
  let pathname: string;
  try { pathname = new URL(req!.url).pathname; } catch { return execute(); }
  if (!paths.has(pathname)) return execute();
  return traces.run({ runId, requestId, route: pathname }, async () => {
    const response = await execute();
    const trace = traces.getStore()!;
    response.headers.set("x-bms-scheduler-run-id", runId);
    response.headers.set("x-bms-scheduler-request-id", requestId);
    if (trace.jobRunId) response.headers.set("x-bms-job-run-id", String(trace.jobRunId));
    const code = knownDiagnosticCode(trace.errorCode);
    if (code) response.headers.set("x-bms-error-code", code);
    return response;
  });
}
