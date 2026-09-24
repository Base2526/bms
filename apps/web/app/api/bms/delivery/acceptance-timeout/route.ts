import { NextResponse, type NextRequest } from "next/server";

import { authorizeCronRequest } from "@/lib/bms/cronRouteAuth";
import { processExpiredDeliveryAcceptances } from "@/lib/bms/deliveryPlatforms/acceptanceTimeout";
import { recordJobRun } from "@/lib/bms/jobRuns";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const cron = authorizeCronRequest(req);
  if (!cron.ok) return cron.response;
  return NextResponse.json(await recordJobRun("delivery-acceptance-timeout", "cron", () =>
    processExpiredDeliveryAcceptances(50)));
}

export const POST = withRouteErrorLog("POST /api/bms/delivery/acceptance-timeout", handlePOST);
