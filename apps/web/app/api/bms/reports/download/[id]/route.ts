// =============================================================
// GET /api/bms/reports/download/[id] — tenant-gated generated-report download
// -------------------------------------------------------------
// Deliberately NOT the same as /api/files/[id] (which has no auth/tenant
// check at all — fine for public product images, not for a generated
// business report). Requires a signed admin session and verifies the
// bms_generated_reports row for this file id belongs to the caller's own
// tenant before streaming anything out of storage.
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { Readable } from "stream";
import { verifyAdminSession } from "@/lib/auth/server";
import { ACT_TENANT_COOKIE, verifyActTenant } from "@/lib/auth/token";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { requirePermission } from "@/lib/bms/permissions";
import { findGeneratedReportByFileId } from "@/lib/bms/reportEngine";
import { query } from "@/lib/db";
import { openStoredFileStream, statStoredFile } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = verifyAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const acting = verifyActTenant(cookies().get(ACT_TENANT_COOKIE)?.value);
  const tenantId =
    acting?.actTenantId && String(acting.by) === String(admin.id)
      ? acting.actTenantId
      : admin.tenant_id || DEFAULT_TENANT_ID;

  const ctx = { scope: "admin", admin: { id: admin.id, role: admin.role, tenant_id: tenantId } };
  try {
    await requirePermission(ctx, "report.view");
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const fileId = Number(params.id);
  if (!fileId || Number.isNaN(fileId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  // ต้องมีแถวใน bms_generated_reports ที่ tenant นี้เป็นเจ้าของ file_id นี้จริง — กัน enumerate
  // sequential file id ข้าม tenant (ต่างจาก /api/files/[id] ที่ไม่เช็คเลย)
  const owned = await findGeneratedReportByFileId(tenantId, fileId);
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { rows } = await query<{ filename: string; original_name: string | null; mimetype: string | null; relpath: string; deleted_at: string | null }>(
    `SELECT filename, original_name, mimetype, relpath, deleted_at FROM files WHERE id = $1 LIMIT 1`,
    [fileId]
  );
  const row = rows[0];
  if (!row || row.deleted_at) return NextResponse.json({ error: "not found" }, { status: 404 });

  const stored = await statStoredFile(row.relpath);
  if (!stored) return NextResponse.json({ error: "file missing in storage" }, { status: 404 });

  const downloadName = (row.original_name || row.filename || `report-${fileId}`).replace(/[\/\\?%*:|"<>]/g, "_");

  const nodeStream = await openStoredFileStream(row.relpath);
  const webStream = Readable.toWeb(nodeStream) as any;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      "Content-Type": row.mimetype || "application/octet-stream",
      "Content-Length": String(stored.size),
      "Content-Disposition": `attachment; filename="${downloadName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      "Cache-Control": "no-store",
    },
  });
}
