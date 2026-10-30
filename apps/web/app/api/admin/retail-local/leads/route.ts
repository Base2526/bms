import { NextRequest, NextResponse } from "next/server";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import { listRetailLocalLeads, RetailLocalLeadError } from "@/lib/bms/retailLocalLeads";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

async function handleGET(request: NextRequest) {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  try {
    const status = request.nextUrl.searchParams.get("status");
    const leads = await listRetailLocalLeads({ adminId: auth.adminId, status });
    return NextResponse.json({ leads }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RetailLocalLeadError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export const GET = withRouteErrorLog("GET /api/admin/retail-local/leads", handleGET);
