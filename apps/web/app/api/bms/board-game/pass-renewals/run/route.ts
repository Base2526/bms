import { NextResponse, type NextRequest } from "next/server";
import { runDueBoardGamePassRenewals } from "@/lib/bms/boardGamePassRenewals";
import { authorizeCronRequest } from "@/lib/bms/cronRouteAuth";
import { recordJobRun } from "@/lib/bms/jobRuns";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const cron = authorizeCronRequest(req);
  if (!cron.ok) return cron.response;
  const result = await recordJobRun("board-game-pass-renewals", "cron", () =>
    runDueBoardGamePassRenewals()
  );
  return NextResponse.json({ ok: true, ...result });
}

export const POST = withRouteErrorLog("POST /api/bms/board-game/pass-renewals/run", handlePOST);

