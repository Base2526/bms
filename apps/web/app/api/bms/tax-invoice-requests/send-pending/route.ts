import { NextResponse, type NextRequest } from "next/server";
import { authorizeCronRequest } from "@/lib/bms/cronRouteAuth";
import { recordJobRun } from "@/lib/bms/jobRuns";
import { runTaxRequestEmailQueue } from "@/lib/bms/taxRequestEmail";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handlePOST(req: NextRequest) {
  const auth = authorizeCronRequest(req);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await recordJobRun("tax-request-email", "cron", runTaxRequestEmailQueue));
  } catch {
    return NextResponse.json({ error: "Tax request email queue failed" }, { status: 500 });
  }
}
export const POST = withRouteErrorLog("POST /api/bms/tax-invoice-requests/send-pending", handlePOST);
