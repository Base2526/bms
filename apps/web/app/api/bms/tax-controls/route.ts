import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { executeTaxControl, listTaxControls, readTaxControlArchive, TaxControlError } from "@/lib/bms/taxDocumentControls";
import { readRetailLocalJSON, RetailLocalRequestBodyError } from "@/lib/bms/retailLocalRequestBody";
import { buildSalesTaxReportDoc, buildInputVatReportDoc } from "@/lib/bms/documentGenerator";
import { renderTaxReportPrint } from "@/lib/bms/taxReportPrint";
import { formatTaxDate } from "@/lib/bms/taxReportMath";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  const code = (error as any)?.extensions?.code;
  const status = error instanceof TaxControlError || error instanceof RetailLocalRequestBodyError ? error.status : code === "FORBIDDEN" ? 403 : 500;
  return NextResponse.json({ error: status === 500 ? "ดำเนินการไม่สำเร็จ / Tax control unavailable" : (error as Error).message }, { status, headers });
}
export async function GET(req: NextRequest) {
  const auth = await authorizeAdminRoute("tax.document.view");
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status, headers });
  try {
    const p = req.nextUrl.searchParams, id = p.get("id");
    if (!id) return NextResponse.json(await listTaxControls(auth.ctx, p.get("month") || "", p.get("locationId")), { headers });
    const period = p.get("period") === "true";
    const snapshot = await readTaxControlArchive(auth.ctx, id, period);
    if (period && p.get("format") === "print") {
      const nonce = randomBytes(16).toString("base64");
      const report = snapshot.report;
      const doc = buildSalesTaxReportDoc(report, date => formatTaxDate(date, report.seller.calendarEra ?? "BE"));
      const purchase = buildInputVatReportDoc(snapshot.purchaseReport, date => formatTaxDate(date, report.seller.calendarEra ?? "BE"));
      doc.sheets.push(...purchase.sheets);
      doc.title += ` · ฉบับปิดงวด ${snapshot.version}`;
      return new NextResponse(renderTaxReportPrint(doc, nonce), { headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'self'` } });
    }
    return NextResponse.json(snapshot, { headers: { ...headers, ...(p.get("download") === "true" ? { "Content-Disposition": `attachment; filename="tax-archive-${id}.json"` } : {}) } });
  } catch (error) { return failure(error); }
}
export async function POST(req: NextRequest) {
  // Action-specific permission is repeated in the service; no action accepts client tenant scope.
  const auth = await authorizeAdminRoute("tax.document.view");
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status, headers });
  if (req.headers.get("origin") !== req.nextUrl.origin) return NextResponse.json({ error: "invalid origin" }, { status: 403, headers });
  try { return NextResponse.json(await executeTaxControl(auth.ctx, await readRetailLocalJSON(req)), { headers }); }
  catch (error) { return failure(error); }
}
