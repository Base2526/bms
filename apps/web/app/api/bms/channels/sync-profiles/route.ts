import { NextResponse, type NextRequest } from "next/server";

import { authorizeCronRequest } from "@/lib/bms/cronRouteAuth";
import { runFacebookProfileBackfill } from "@/lib/bms/facebookProfile";
import { recordJobRun } from "@/lib/bms/jobRuns";
import { runLineProfileBackfill } from "@/lib/bms/lineProfile";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const cron = authorizeCronRequest(req);
  if (!cron.ok) return cron.response;

  const result = await recordJobRun("channel-profile-sync", "cron", async () => {
    const [facebook, line] = await Promise.all([
      runFacebookProfileBackfill(20),
      runLineProfileBackfill(20),
    ]);
    return { facebook, line };
  });
  return NextResponse.json({ ok: true, ...result });
}

export const POST = withRouteErrorLog("POST /api/bms/channels/sync-profiles", handlePOST);
