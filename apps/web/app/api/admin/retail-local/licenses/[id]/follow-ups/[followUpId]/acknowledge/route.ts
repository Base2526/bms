import { NextRequest, NextResponse } from "next/server";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import { acknowledgeRetailLocalTrialFollowUp, RetailLocalLicenseError } from "@/lib/bms/retailLocalLicensing";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

async function handlePOST(request: NextRequest, context: { params: { id: string; followUpId: string } }) {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  try {
    const body = await request.json();
    return NextResponse.json(await acknowledgeRetailLocalTrialFollowUp({
      licenseId: context.params.id,
      followUpId: context.params.followUpId,
      note: String(body?.note ?? ""),
      adminId: auth.adminId,
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RetailLocalLicenseError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export const POST = withRouteErrorLog(
  "POST /api/admin/retail-local/licenses/[id]/follow-ups/[followUpId]/acknowledge",
  handlePOST,
);
