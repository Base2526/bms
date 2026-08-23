// POST /api/bms/payment/:id/confirm — signed admin + payment.confirm
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifyAdminSession } from "@/lib/auth/server";
import { ACT_TENANT_COOKIE, verifyActTenant } from "@/lib/auth/token";
import { confirmPayment } from "@/lib/bms/payments";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { requirePermission } from "@/lib/bms/permissions";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = verifyAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const acting = verifyActTenant(cookies().get(ACT_TENANT_COOKIE)?.value);
  const tenantId = acting?.actTenantId && String(acting.by) === String(admin.id)
    ? acting.actTenantId
    : admin.tenant_id || DEFAULT_TENANT_ID;
  try {
    await requirePermission({ scope: "admin", admin: { ...admin, tenant_id: tenantId } }, "payment.confirm");
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "payment id required" }, { status: 400 });
  const result = await confirmPayment(tenantId, id, String(admin.id));
  const httpStatus =
    result.status === "CONFIRMED" ? 200
      : result.status === "NOT_FOUND" ? 404
      : result.status === "INVALID_AMOUNT" ? 422
      : 409; // INVALID_STATE / INVALID_ORDER_STATE
  return NextResponse.json(result, { status: httpStatus });
}

export const POST = withRouteErrorLog("POST /api/bms/payment/[id]/confirm", handlePOST);
