import { NextRequest, NextResponse } from "next/server";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import { issueRetailLocalActivationCode, RetailLocalLicenseError } from "@/lib/bms/retailLocalLicensing";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

async function handlePOST(request: NextRequest, context: { params: { id: string } }) {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  try {
    const body = await request.json();
    if (body?.confirmation !== "ISSUE-RETAIL-LOCAL-ACTIVATION") {
      throw new RetailLocalLicenseError("ต้องยืนยันด้วย ISSUE-RETAIL-LOCAL-ACTIVATION");
    }
    return NextResponse.json(await issueRetailLocalActivationCode(context.params.id, auth.adminId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof RetailLocalLicenseError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export const POST = withRouteErrorLog(
  "POST /api/admin/retail-local/licenses/[id]/activation",
  handlePOST,
);
