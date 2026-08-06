// =============================================================
// POST /api/bms/jobs/report-run — let a job that ran OUTSIDE this app
// (e.g. the daily-log-triage GitHub Action) record its own outcome into
// bms_job_runs, so /admin/operations-schedule has real history for it too.
// -------------------------------------------------------------
//   curl -X POST ".../api/bms/jobs/report-run" \
//     -H "x-cron-secret: $BMS_CRON_SECRET" -H "content-type: application/json" \
//     -d '{"jobName":"daily-log-triage","status":"success","output":{"errorGroups":3}}'
//
// ป้องกันด้วย header x-cron-secret เดียวกับ cron endpoint อื่นทั้งหมด — ไม่ใช่
// endpoint สาธารณะ, ห้ามเปิดให้เรียกได้โดยไม่มี secret
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { recordExternalJobRun } from "@/lib/bms/jobRuns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_STATUS = new Set(["success", "error"]);

export async function POST(req: NextRequest) {
  const secret = process.env.BMS_CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const jobName = String(body?.jobName ?? "").trim();
  const status = String(body?.status ?? "");

  if (!jobName) return NextResponse.json({ error: "jobName is required" }, { status: 400 });
  if (!ALLOWED_STATUS.has(status)) {
    return NextResponse.json({ error: "status must be 'success' or 'error'" }, { status: 400 });
  }

  await recordExternalJobRun({
    jobName,
    status: status as "success" | "error",
    durationMs: typeof body?.durationMs === "number" ? body.durationMs : null,
    output: body?.output ?? null,
    error: body?.error ?? null,
    triggeredBy: "cron",
  });

  return NextResponse.json({ ok: true });
}
