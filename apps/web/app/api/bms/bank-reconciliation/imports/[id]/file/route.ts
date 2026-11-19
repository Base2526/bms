import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";
import path from "path";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { queryBankReconciliation } from "@/lib/bms/bankReconciliation";
import { requireBankReconciliationEnabled } from "@/lib/bms/bankReconciliationFeature";
import { query } from "@/lib/db";
import { openStoredFileStream, statStoredFile } from "@/lib/storage";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function handleGET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await authorizeAdminRoute("bank_reconciliation.view");
  if (!auth.ok)
    return NextResponse.json(
      { error: auth.status === 401 ? "unauthorized" : "not found" },
      { status: auth.status === 401 ? 401 : 404 },
    );
  try {
    requireBankReconciliationEnabled();
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!UUID.test(params.id))
    return NextResponse.json({ error: "not found" }, { status: 404 });
  const imported = await queryBankReconciliation<{ file_id: number | null }>(
    auth.tenantId,
    `SELECT file_id FROM bms_bank_statement_imports WHERE tenant_id=$1 AND id=$2 LIMIT 1`,
    [auth.tenantId, params.id],
  );
  if (!imported.rows[0]?.file_id)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  const found = await query<any>(
    `SELECT relpath,original_name,mimetype,size FROM files
    WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL LIMIT 1`,
    [auth.tenantId, imported.rows[0].file_id],
  );
  const row = found.rows[0];
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const stat = await statStoredFile(row.relpath);
  if (!stat) return NextResponse.json({ error: "not found" }, { status: 404 });
  const stream = Readable.toWeb(
    await openStoredFileStream(row.relpath),
  ) as ReadableStream;
  const safeName = path
    .basename(String(row.original_name || "bank-statement"))
    .replace(/[\r\n"\\/]/g, "_");
  return new NextResponse(stream, {
    headers: {
      "Content-Type": row.mimetype || "application/octet-stream",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const GET = withRouteErrorLog(
  "GET /api/bms/bank-reconciliation/imports/[id]/file",
  handleGET,
);
