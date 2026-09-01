// Daily retention worker for private support bundles. This is fleet-wide and
// therefore accepts cron authority only, never a tenant id from a caller.

import { NextResponse, type NextRequest } from "next/server";
import { authorizeCronRequest } from "@/lib/bms/cronRouteAuth";
import { recordJobRun } from "@/lib/bms/jobRuns";
import { purgeExpiredSupportBundles } from "@/lib/bms/supportDiagnostics";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const cron = authorizeCronRequest(req);
  if (!cron.ok) return cron.response;
  try {
    const result = await recordJobRun(
      "support-diagnostics-retention",
      "cron",
      () => purgeExpiredSupportBundles(100)
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export const POST = withRouteErrorLog(
  "POST /api/bms/support-diagnostics/purge-expired",
  handlePOST
);
