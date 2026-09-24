import { NextResponse, type NextRequest } from "next/server";

import { authorizeCronRequest } from "@/lib/bms/cronRouteAuth";
import { runDeliveryEventBatch } from "@/lib/bms/deliveryPlatforms/eventWorker";
import { recordJobRun } from "@/lib/bms/jobRuns";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const cron = authorizeCronRequest(req);
  if (!cron.ok) return cron.response;
  const result = await recordJobRun(
    "delivery-events-process",
    "cron",
    () => runDeliveryEventBatch(25),
  );
  return NextResponse.json({ ok: true, ...result });
}

export const POST = withRouteErrorLog(
  "POST /api/bms/delivery/events/process",
  handlePOST,
);
