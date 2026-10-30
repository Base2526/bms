import { NextRequest, NextResponse } from "next/server";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import { RetailLocalLeadError, eraseRetailLocalLead, updateRetailLocalLead } from "@/lib/bms/retailLocalLeads";
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

// PDPA erasure on request: clears the lead's contact details and history snapshots
// (10.106). Same platform-admin and same-origin gates as PATCH. Returns no PII.
async function handleDELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  try {
    const result = await eraseRetailLocalLead({ id: params.id, adminId: auth.adminId });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RetailLocalLeadError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw new Error("retail_local_lead_erase_unavailable");
  }
}

export const DELETE = withRouteErrorLog("DELETE /api/admin/retail-local/leads/[id]", handleDELETE);
