import { NextResponse, type NextRequest } from "next/server";

import { authorizeCronRequest } from "@/lib/bms/cronRouteAuth";
import { runScheduledDeliveryPreparationBatch } from "@/lib/bms/deliveryPlatforms/scheduledPreparation";
import { recordJobRun } from "@/lib/bms/jobRuns";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const cron = authorizeCronRequest(req);
  if (!cron.ok) return cron.response;
  const result = await recordJobRun("delivery-scheduled-preparation", "cron", () =>
    runScheduledDeliveryPreparationBatch(50));
  return NextResponse.json(result);
}

export const POST = withRouteErrorLog("POST /api/bms/delivery/scheduled-preparation", handlePOST);
