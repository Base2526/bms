import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import {
  listStaleBankEntryIds,
  queryBankReconciliation,
} from "@/lib/bms/bankReconciliation";
import { requireBankReconciliationEnabled } from "@/lib/bms/bankReconciliationFeature";
import { audit } from "@/lib/bms/audit";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])-01$/;
function safeCell(value: unknown): string | number {
  if (typeof value === "number") return value;
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 1000);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

async function handleGET(request: NextRequest) {
  const auth = await authorizeAdminRoute("bank_reconciliation.view");
  if (!auth.ok)
    return NextResponse.json(
      { error: auth.status === 401 ? "unauthorized" : "forbidden" },
      { status: auth.status },
    );
  try {
    requireBankReconciliationEnabled();
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const accountId = request.nextUrl.searchParams.get("accountId") || "";
  const month = request.nextUrl.searchParams.get("month") || "";
  const format =
    request.nextUrl.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  if (!UUID.test(accountId) || !MONTH.test(month))
    return NextResponse.json({ error: "invalid parameters" }, { status: 400 });
  const staleIds = await listStaleBankEntryIds(auth.tenantId, accountId, month);
  const result = await queryBankReconciliation<any>(
    auth.tenantId,
    `SELECT e.posted_on,e.direction,e.amount,e.balance_after,e.reference,e.description,
      e.counterparty_masked,CASE WHEN e.id=ANY($4::uuid[]) THEN 'STALE' ELSE e.reconciliation_status END reconciliation_status,
      COALESCE(sum(l.matched_amount),0) matched_amount,
      COALESCE(string_agg(l.source_key, ', ' ORDER BY l.source_key) FILTER(WHERE l.status='CONFIRMED'),'') source_keys
    FROM bms_bank_statement_entries e JOIN bms_bank_statement_imports i ON i.tenant_id=e.tenant_id AND i.id=e.import_id
    LEFT JOIN bms_bank_reconciliation_links l ON l.tenant_id=e.tenant_id AND l.bank_entry_id=e.id AND l.status='CONFIRMED'
    WHERE e.tenant_id=$1 AND e.bank_account_id=$2 AND i.status='COMMITTED'
      AND e.posted_on >=$3::date AND e.posted_on<$3::date+interval '1 month'
    GROUP BY e.id ORDER BY e.posted_on,e.line_no`,
    [auth.tenantId, accountId, month, staleIds],
  );
  const rows = result.rows.map((r: any) => ({
    Date: safeCell(String(r.posted_on).slice(0, 10)),
    Direction: safeCell(r.direction),
    // Keep NUMERIC(18,2) as text: JavaScript/Excel numbers only retain about
    // 15 significant digits and would silently change large financial values.
    Amount: String(r.amount),
    Balance: r.balance_after == null ? "" : String(r.balance_after),
    Reference: safeCell(r.reference),
    Description: safeCell(r.description),
    Counterparty: safeCell(r.counterparty_masked),
    Status: safeCell(r.reconciliation_status),
    MatchedAmount: String(r.matched_amount),
    Sources: safeCell(r.source_keys),
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  let body: Buffer;
  let contentType: string;
  let ext: string;
  if (format === "csv") {
    body = Buffer.from(XLSX.utils.sheet_to_csv(sheet), "utf8");
    contentType = "text/csv; charset=utf-8";
    ext = "csv";
  } else {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Reconciliation");
    body = XLSX.write(wb, {
      type: "buffer",
      bookType: "xlsx",
      compression: true,
    });
    contentType =
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    ext = "xlsx";
  }
  await audit(auth.ctx, "bank_reconciliation.export", `${accountId}:${month}`, {
    format,
    rowCount: rows.length,
  });
  const filename = `bank-reconciliation-${month.slice(0, 7)}.${ext}`;
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const GET = withRouteErrorLog(
  "GET /api/bms/bank-reconciliation/export",
  handleGET,
);
