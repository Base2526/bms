// =============================================================
// POST /api/bms/pharmacy/assessments/expire-stale — cron TTL sweep
// -------------------------------------------------------------
//   curl -X POST "http://localhost:3000/api/bms/pharmacy/assessments/expire-stale" \
//     -H "x-cron-secret: $BMS_CRON_SECRET"
//
// Same shape as /api/bms/orders/release-expired — x-cron-secret gate +
// recordJobRun() so /admin/operations-schedule gets real run history.
// This is the batch sweep; the lazy re-check inside approveAssessment() in
// lib/bms/pharmacy/assessments.ts is the actual safety net that prevents
// approving an expired case without re-evaluation — this endpoint just
// keeps stale open cases from piling up forever.
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { expireStaleAssessments } from "@/lib/bms/pharmacy/assessments";
import { recordJobRun } from "@/lib/bms/jobRuns";
import { isPharmacyIntakeEnabled } from "@/lib/bms/pharmacy/config";
import { authorizeCronRequest } from "@/lib/bms/cronRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const cron = authorizeCronRequest(req);
  if (!cron.ok) return cron.response;
  if (!isPharmacyIntakeEnabled()) {
    return NextResponse.json({ ok: true, closed: 0, skipped: "PHARMACY_INTAKE_ENABLED is false" });
  }

  try {
    const result = await recordJobRun("pharmacy-expire-stale", "cron", () => expireStaleAssessments());
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}

export const POST = withRouteErrorLog("POST /api/bms/pharmacy/assessments/expire-stale", handlePOST);
