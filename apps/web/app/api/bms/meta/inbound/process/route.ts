import { NextResponse, type NextRequest } from "next/server";

import { authorizeCronRequest } from "@/lib/bms/cronRouteAuth";
import { recordJobRun } from "@/lib/bms/jobRuns";
import { runMetaInboundBatch } from "@/lib/bms/metaInboundJobs";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const cron = authorizeCronRequest(req);
  if (!cron.ok) return cron.response;
  const result = await recordJobRun(
    "meta-inbound-process",
    "cron",
    () => runMetaInboundBatch(50),
  );
  return NextResponse.json({ ok: true, ...result });
}

export const POST = withRouteErrorLog("POST /api/bms/meta/inbound/process", handlePOST);
