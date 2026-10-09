// =============================================================
// BMS Job Runs — execution history for cron/batch entrypoints (7.55)
// -------------------------------------------------------------
// Platform-wide, no tenant_id — a cron invocation isn't a tenant's data.
// `job_name` should match the `key` used in operationsSchedule.ts's
// DEFINITIONS array so the two line up in the /admin/operations-schedule UI.
//
// Single entrypoint is `recordJobRun()` — every cron route wraps its real
// work in this instead of calling start/finish separately, so a route can
// never forget to close out a 'running' row on either success or throw.
// =============================================================

import { query } from "@/lib/db";
import { writeLogServer } from "@/lib/log/writeLog.server";
import { scheduledJobTrace } from "./scheduledJobTrace";
import { diagnoseError } from "../../scheduler/diagnostics.mjs";

export type JobRunStatus = "running" | "success" | "error";

export type JobRunRow = {
  id: number;
  jobName: string;
  status: JobRunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  output: unknown;
  error: string | null;
  triggeredBy: string | null;
};

function mapRow(r: any): JobRunRow {
  return {
    id: Number(r.id),
    jobName: r.job_name,
    status: r.status,
    startedAt: new Date(r.started_at).toISOString(),
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    durationMs: r.duration_ms ?? null,
    output: r.output ?? null,
    error: r.error ?? null,
    triggeredBy: r.triggered_by ?? null,
  };
}

/**
 * Run `fn()` as one recorded job invocation: inserts a 'running' row, then
 * updates it to 'success' (with `fn`'s return value as `output`) or 'error'
 * (with the caught error's message) once `fn` settles. Re-throws on error so
 * the calling route still returns its own error response — this only adds
 * a persisted record, it never changes what the route itself returns.
 */
export async function recordJobRun<T>(
  jobName: string,
  triggeredBy: "cron" | "manual",
  fn: () => Promise<T>
): Promise<T> {
  const trace = scheduledJobTrace();
  let id: number | null = null;
  let stage = "record-start";
  const startedAt = Date.now();
  const emit = (status: string, extra: Record<string, unknown> = {}) => {
    if (!trace) return;
    const event = { at: new Date().toISOString(), component: "scheduled-job", job: jobName,
      ...trace, jobRunId: id, status, stage, durationMs: Date.now() - startedAt, ...extra };
    if (status === "error") console.error(JSON.stringify(event));
    else console.log(JSON.stringify(event));
  };
  const traceOutput = (result: unknown) => trace ? { result, scheduler: { ...trace, jobRunId: id } } : result;
  emit("started");
  try {
    const { rows } = await query<{ id: number }>(
      `INSERT INTO bms_job_runs (job_name, status, triggered_by, output) VALUES ($1, 'running', $2, $3) RETURNING id`,
      [jobName, triggeredBy, trace ? JSON.stringify(traceOutput(null)) : null]
    );
    id = rows[0].id;
    if (trace) trace.jobRunId = id;
    stage = "execute";
    const result = await fn();
    stage = "record-success";
    await query(
      `UPDATE bms_job_runs
          SET status = 'success', finished_at = now(), duration_ms = $2, output = $3
        WHERE id = $1`,
      [id, Date.now() - startedAt, JSON.stringify(traceOutput(result ?? null))]
    );
    emit("success");
    return result;
  } catch (err: any) {
    const diagnostic = diagnoseError(err);
    if (trace) trace.errorCode = diagnostic.code;
    emit("error", { diagnostic });
    if (trace) {
      // Also reaches the existing system_logs/triage path even if the route catches
      // the exception. Stdout above remains available when the DB itself is down.
      void writeLogServer("error", "scheduler", `${jobName}: ${diagnostic.hint}`, {
        action: "scheduler.job.failed", correlationId: trace.runId,
        schedulerRequestId: trace.requestId, routeName: `POST ${trace.route}`, jobRunId: id, stage,
        errorMessage: `${diagnostic.code}: ${diagnostic.hint}`,
        stack: diagnostic.frames.join("\n"), diagnostic,
      }).then((saved) => {
        if (!saved) emit("error", { stage: "system-log-write", code: "SYSTEM_LOG_WRITE_FAILED" });
      }).catch((logError) => {
        emit("error", { stage: "system-log-write", code: "SYSTEM_LOG_WRITE_FAILED", diagnostic: diagnoseError(logError) });
      });
    }
    try {
      if (id !== null) await query(
        `UPDATE bms_job_runs
          SET status = 'error', finished_at = now(), duration_ms = $2, error = $3,
              output = CASE WHEN $4::jsonb IS NULL THEN output ELSE $4::jsonb END
        WHERE id = $1`,
        [id, Date.now() - startedAt, String(err?.message ?? err),
          trace ? JSON.stringify({ scheduler: { ...trace, jobRunId: id }, diagnostic, stage }) : null]
      );
    } catch (recordError) {
      emit("error", { stage: "record-error", diagnostic: diagnoseError(recordError) });
      // Never replace the business failure with a second failure writing its history.
    }
    throw err;
  }
}

/**
 * For jobs that don't run inside this app's process (e.g. the
 * `daily-log-triage` GitHub Action) — the job already finished elsewhere and
 * is just reporting its outcome. Unlike recordJobRun(), this writes one
 * already-closed row directly instead of wrapping a live function call.
 */
export async function recordExternalJobRun(input: {
  jobName: string;
  status: "success" | "error";
  durationMs?: number | null;
  output?: unknown;
  error?: string | null;
  triggeredBy?: "cron" | "manual" | null;
}): Promise<void> {
  await query(
    `INSERT INTO bms_job_runs (job_name, status, started_at, finished_at, duration_ms, output, error, triggered_by)
     VALUES ($1, $2, now() - make_interval(secs => $3::float / 1000.0), now(), $3, $4, $5, $6)`,
    [
      input.jobName,
      input.status,
      input.durationMs ?? 0,
      input.output != null ? JSON.stringify(input.output) : null,
      input.error ?? null,
      input.triggeredBy ?? "cron",
    ]
  );
}

export async function listJobRuns(jobName: string, limit = 20): Promise<JobRunRow[]> {
  const { rows } = await query(
    `SELECT * FROM bms_job_runs WHERE job_name = $1 ORDER BY started_at DESC LIMIT $2`,
    [jobName, limit]
  );
  return rows.map(mapRow);
}

/** One row per distinct job_name — its most recent invocation, for a summary/status-chip view. */
export async function listLatestJobRunPerJob(): Promise<JobRunRow[]> {
  const { rows } = await query(
    `SELECT DISTINCT ON (job_name) *
       FROM bms_job_runs
      ORDER BY job_name, started_at DESC`
  );
  return rows.map(mapRow);
}
