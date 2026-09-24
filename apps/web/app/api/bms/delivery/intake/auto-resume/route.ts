import { NextResponse, type NextRequest } from "next/server";

import { authorizeCronRequest } from "@/lib/bms/cronRouteAuth";
import { runDeliveryAutoResumeBatch } from "@/lib/bms/deliveryPlatforms/intake";
import { recordJobRun } from "@/lib/bms/jobRuns";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const cron = authorizeCronRequest(req);
  if (!cron.ok) return cron.response;
  const result = await recordJobRun(
    "delivery-intake-auto-resume",
    "cron",
    () => runDeliveryAutoResumeBatch(25),
  );
  return NextResponse.json({ ok: true, ...result });
}

export const POST = withRouteErrorLog(
  "POST /api/bms/delivery/intake/auto-resume",
  handlePOST,
);
