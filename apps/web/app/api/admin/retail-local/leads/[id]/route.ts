import { NextRequest, NextResponse } from "next/server";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import { RetailLocalLeadError, updateRetailLocalLead } from "@/lib/bms/retailLocalLeads";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { readRetailLocalJSON, RetailLocalRequestBodyError } from "@/lib/bms/retailLocalRequestBody";

export const dynamic = "force-dynamic";

async function handlePATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  try {
    const body = await readRetailLocalJSON(request, 16_384) as Record<string, unknown> | null;
    const lead = await updateRetailLocalLead({
      id: params.id,
      adminId: auth.adminId,
      status: body?.status,
      note: body?.note,
      followUpAt: body?.followUpAt,
    });
    return NextResponse.json({ lead }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RetailLocalLeadError || error instanceof RetailLocalRequestBodyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
    }
    throw new Error("retail_local_lead_update_unavailable");
  }
}

export const PATCH = withRouteErrorLog("PATCH /api/admin/retail-local/leads/[id]", handlePATCH);
