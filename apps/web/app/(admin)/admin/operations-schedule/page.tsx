import OperationsScheduleClient from "./OperationsScheduleClient";
import { listOperationSchedules } from "@/lib/bms/operationsSchedule";
import { listJobRuns, type JobRunRow } from "@/lib/bms/jobRuns";

// Execution history comes from PostgreSQL and must be read per request, not at build time.
export const dynamic = "force-dynamic";

export default async function OperationsSchedulePage() {
  const rows = await listOperationSchedules();

  // Real execution history per job (7.55__bms_job_runs.sql) — one query per
  // known job key, capped small since this page only lists a handful of jobs.
  const runsByJob: Record<string, JobRunRow[]> = {};
  await Promise.all(
    rows.map(async (row) => {
      runsByJob[row.key] = await listJobRuns(row.key, 15);
    })
  );

  return <OperationsScheduleClient rows={rows} runsByJob={runsByJob} />;
}
