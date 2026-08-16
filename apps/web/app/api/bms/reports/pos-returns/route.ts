import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifyAdminSession } from "@/lib/auth/server";
import { ACT_TENANT_COOKIE, verifyActTenant } from "@/lib/auth/token";
import { getPosReturnSummary } from "@/lib/bms/reports";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { requirePermission } from "@/lib/bms/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = verifyAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const acting = verifyActTenant(cookies().get(ACT_TENANT_COOKIE)?.value);
  const tenantId = acting?.actTenantId && String(acting.by) === String(admin.id)
    ? acting.actTenantId
    : admin.tenant_id || DEFAULT_TENANT_ID;
  const ctx = { scope: "admin", admin: { ...admin, tenant_id: tenantId } };
  try {
    await requirePermission(ctx, "report.view");
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const summary = await getPosReturnSummary(
    tenantId,
    url.searchParams.get("from"),
    url.searchParams.get("to")
  );
  return NextResponse.json(summary);
}
