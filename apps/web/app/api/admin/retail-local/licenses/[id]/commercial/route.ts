import { NextRequest, NextResponse } from "next/server";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import {
  RetailLocalLicenseError,
  updateRetailLocalLicenseCommercialState,
  type RetailLocalCommercialAction,
} from "@/lib/bms/retailLocalLicensing";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

const CONFIRMATIONS: Record<RetailLocalCommercialAction, string> = {
  CONVERT_TO_PAID: "CONVERT-RETAIL-LOCAL-TO-PAID",
  EXTEND_TRIAL: "EXTEND-RETAIL-LOCAL-TRIAL",
  MARK_PAYMENT_REVIEW: "MARK-RETAIL-LOCAL-PAYMENT-REVIEW",
  REACTIVATE: "REACTIVATE-RETAIL-LOCAL-LICENSE",
  CANCEL: "CANCEL-RETAIL-LOCAL-LICENSE",
};

async function handlePOST(request: NextRequest, context: { params: { id: string } }) {
  const auth = await authorizePlatformAdminRoute();
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  try {
    const body = await request.json();
    const action = String(body?.action ?? "") as RetailLocalCommercialAction;
    if (!(action in CONFIRMATIONS)) throw new RetailLocalLicenseError("commercial action ไม่ถูกต้อง");
    if (body?.confirmation !== CONFIRMATIONS[action]) {
      throw new RetailLocalLicenseError(`ต้องยืนยันด้วย ${CONFIRMATIONS[action]}`);
    }
    const result = await updateRetailLocalLicenseCommercialState({
      licenseId: context.params.id,
      action,
      extensionDays: body?.extensionDays,
      reason: String(body?.reason ?? ""),
      adminId: auth.adminId,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RetailLocalLicenseError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export const POST = withRouteErrorLog(
  "POST /api/admin/retail-local/licenses/[id]/commercial",
  handlePOST,
);
