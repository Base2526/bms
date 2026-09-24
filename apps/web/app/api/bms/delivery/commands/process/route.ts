import { NextResponse, type NextRequest } from "next/server";

import { authorizeCronRequest } from "@/lib/bms/cronRouteAuth";
import { runDeliveryCommandBatch } from "@/lib/bms/deliveryPlatforms/commands";
import { recordJobRun } from "@/lib/bms/jobRuns";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const cron = authorizeCronRequest(req);
  if (!cron.ok) return cron.response;
  const result = await recordJobRun(
    "delivery-commands-process",
    "cron",
    () => runDeliveryCommandBatch(25),
  );
  return NextResponse.json({ ok: true, ...result });
}

export const POST = withRouteErrorLog(
  "POST /api/bms/delivery/commands/process",
  handlePOST,
);
