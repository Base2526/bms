// GET /api/bms/reports/sales?from=YYYY-MM-DD&to=YYYY-MM-DD   [Phase 1: default tenant]
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSalesSummary } from "@/lib/bms/reports";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const url = new URL(req.url);
  const summary = await getSalesSummary(
    DEFAULT_TENANT_ID,
    url.searchParams.get("from"),
    url.searchParams.get("to")
  );
  return NextResponse.json(summary);
}

export const GET = withRouteErrorLog("GET /api/bms/reports/sales", handleGET);
