// =============================================================
// POST /api/bms/reports/generate — curl-testable report generation
// -------------------------------------------------------------
//   curl -b /tmp/bms-cookies.txt -X POST http://localhost:3000/api/bms/reports/generate \
//     -H "content-type: application/json" \
//     -d '{"reportType":"SALES","dateFrom":"2026-01-01","dateTo":"2026-03-31","format":"XLSX"}'
//
// ต้องมี signed admin cookie (เหมือน /api/bms/chat) + สิทธิ์ report.view จริง — เรียก
// generateReport() ตรง ๆ ข้าม AI tool-calling loop ไว้ทดสอบ/scripting
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifyAdminSession } from "@/lib/auth/server";
import { ACT_TENANT_COOKIE, verifyActTenant } from "@/lib/auth/token";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { requirePermission } from "@/lib/bms/permissions";
import { generateReport } from "@/lib/bms/reportEngine";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const admin = verifyAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const acting = verifyActTenant(cookies().get(ACT_TENANT_COOKIE)?.value);
  const tenantId =
    acting?.actTenantId && String(acting.by) === String(admin.id)
      ? acting.actTenantId
      : admin.tenant_id || DEFAULT_TENANT_ID;

  const ctx = { scope: "admin", admin: { id: admin.id, role: admin.role, tenant_id: tenantId, email: (admin as any).email } };

  try {
    await requirePermission(ctx, "report.view");
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    reportType?: unknown;
    dateFrom?: unknown;
    dateTo?: unknown;
    format?: unknown;
    includeSummary?: unknown;
  };

  try {
    const result = await generateReport(tenantId, ctx, {
      reportType: String(body.reportType ?? ""),
      dateFrom: typeof body.dateFrom === "string" ? body.dateFrom : null,
      dateTo: typeof body.dateTo === "string" ? body.dateTo : null,
      format: String(body.format ?? ""),
      includeSummary: body.includeSummary !== false,
    });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "generate failed" }, { status: 400 });
  }
}

export const POST = withRouteErrorLog("POST /api/bms/reports/generate", handlePOST);
