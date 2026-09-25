import { NextRequest, NextResponse } from "next/server";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import { RetailLocalLicenseError, rotateRetailLocalLicenseToken } from "@/lib/bms/retailLocalLicensing";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

async function handlePOST(request: NextRequest, context: { params: { id: string } }) {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  try {
    const body = await request.json();
    if (body?.confirmation !== "ROTATE-LICENSE-TOKEN") {
      throw new RetailLocalLicenseError("ต้องยืนยันด้วย ROTATE-LICENSE-TOKEN");
    }
    return NextResponse.json(await rotateRetailLocalLicenseToken(context.params.id, auth.adminId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof RetailLocalLicenseError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export const POST = withRouteErrorLog("POST /api/admin/retail-local/licenses/[id]/token", handlePOST);
