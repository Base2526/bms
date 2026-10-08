import { NextResponse, type NextRequest } from "next/server";
import { authorizeCronRequest } from "@/lib/bms/cronRouteAuth";
import { recordJobRun } from "@/lib/bms/jobRuns";
import { purgeAnswerEvidence } from "@/lib/bms/answerEvidenceStore";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handlePOST(req: NextRequest) {
  const auth = authorizeCronRequest(req);
  if (!auth.ok) return auth.response;
  const after = req.nextUrl.searchParams.get("afterTenant");
  if (after && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(after)) {
    return NextResponse.json({ error: "INVALID_CURSOR" }, { status: 400 });
  }
  const result = await recordJobRun("ai-answer-evidence-retention", "cron", () => purgeAnswerEvidence(after));
  return NextResponse.json({ ok: true, ...result });
}
export const POST = withRouteErrorLog("POST /api/bms/ai/evidence/purge-expired", handlePOST);
