import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { getTaxPrintReport } from "@/lib/bms/reportEngine";
import { renderTaxReportPrint } from "@/lib/bms/taxReportPrint";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("report.view");
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  const params = req.nextUrl.searchParams;
  try {
    const doc = await getTaxPrintReport(auth.tenantId, auth.ctx, {
      reportType: params.get("reportType") ?? "", from: params.get("from") ?? "",
      to: params.get("to") ?? "", locationId: params.get("locationId") || null,
    });
    const nonce = randomBytes(18).toString("base64");
    return new NextResponse(renderTaxReportPrint(doc, nonce), { headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    } });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "พิมพ์รายงานไม่สำเร็จ" }, {
      status: error?.extensions?.code === "FORBIDDEN" ? 403 : 400, headers: { "Cache-Control": "no-store" },
    });
  }
}

export const GET = withRouteErrorLog("GET /api/bms/reports/tax-print", handleGET);
