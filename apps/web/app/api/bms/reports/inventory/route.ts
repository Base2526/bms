// GET /api/bms/reports/inventory — สรุปสต็อก   [Phase 1: default tenant]
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getInventorySummary } from "@/lib/bms/reports";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(_req: NextRequest) {
  const summary = await getInventorySummary(DEFAULT_TENANT_ID);
  return NextResponse.json(summary);
}

export const GET = withRouteErrorLog("GET /api/bms/reports/inventory", handleGET);
