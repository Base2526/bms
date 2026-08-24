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
import { generateReport } from "@/lib/bms/reportEngine";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("report.view");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });

  const body = (await req.json().catch(() => ({}))) as {
    reportType?: unknown;
    dateFrom?: unknown;
    dateTo?: unknown;
    format?: unknown;
    includeSummary?: unknown;
  };

  try {
    const result = await generateReport(auth.tenantId, auth.ctx, {
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
