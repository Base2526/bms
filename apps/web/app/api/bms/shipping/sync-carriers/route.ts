// =============================================================
// POST /api/bms/shipping/sync-carriers - cron: refresh active carrier tracking
// -------------------------------------------------------------
//   curl -X POST "http://localhost:3000/api/bms/shipping/sync-carriers" \
//     -H "x-cron-secret: $BMS_CRON_SECRET"
//
// Scans active Flash/Kerry shipments whose last sync is older than 15 minutes.
// Recommended every 15 minutes; no repository-level schedule is configured.
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { recordJobRun } from "@/lib/bms/jobRuns";
import { runCarrierTrackingSync } from "@/lib/bms/shipping";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const secret = process.env.BMS_CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await recordJobRun("carrier-tracking-sync", "cron", () => runCarrierTrackingSync());
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withRouteErrorLog("POST /api/bms/shipping/sync-carriers", handlePOST);
