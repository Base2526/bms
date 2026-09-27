import { NextResponse, type NextRequest } from "next/server";

import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { getDeliveryProviderAnalytics } from "@/lib/bms/deliveryAnalytics";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("delivery.settlement.view");
  if (!auth.ok) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: auth.status });
  const search = new URL(req.url).searchParams;
  try {
    const analytics = await getDeliveryProviderAnalytics({
      tenantId: auth.tenantId,
      from: search.get("from"),
      to: search.get("to"),
      locationId: search.get("locationId"),
      granularity: search.get("granularity"),
    });
    return NextResponse.json(analytics, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "DELIVERY_ANALYTICS_INVALID";
    if (!code.startsWith("DELIVERY_ANALYTICS_")) throw error;
    return NextResponse.json({ error: code }, { status: code.includes("NOT_FOUND") ? 404 : 400 });
  }
}

export const GET = withRouteErrorLog("GET /api/bms/delivery/analytics", handleGET);
