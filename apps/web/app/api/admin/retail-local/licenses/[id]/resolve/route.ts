import { NextRequest, NextResponse } from "next/server";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import { resolveRetailLocalLicenseReview, RetailLocalLicenseError } from "@/lib/bms/retailLocalLicensing";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

async function handlePOST(request: NextRequest, context: { params: { id: string } }) {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  try {
    const body = await request.json();
    if (!body || !["APPROVE", "TRANSFER", "DEACTIVATE"].includes(body.action)) {
      throw new RetailLocalLicenseError("action ไม่ถูกต้อง");
    }
    const confirmations: Record<string, string> = {
      APPROVE: "APPROVE-LICENSE-INSTALLATION",
      TRANSFER: "TRANSFER-LICENSE-INSTALLATION",
      DEACTIVATE: "DEACTIVATE-LICENSE-INSTALLATION",
    };
    if (body.confirmation !== confirmations[body.action]) {
      throw new RetailLocalLicenseError(`ต้องยืนยันด้วย ${confirmations[body.action]}`);
    }
    return NextResponse.json(await resolveRetailLocalLicenseReview({
      licenseId: context.params.id,
      installationId: String(body.installationId ?? ""),
      fromInstallationId: body.fromInstallationId ? String(body.fromInstallationId) : undefined,
      action: body.action,
      adminId: auth.adminId,
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RetailLocalLicenseError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export const POST = withRouteErrorLog("POST /api/admin/retail-local/licenses/[id]/resolve", handlePOST);
