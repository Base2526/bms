// apps/web/app/api/files/route.ts
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { persistWebFile } from "@/lib/storage";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { verifyAdminSession, verifyUserSession } from "@/lib/auth/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { rateLimit } from "@/lib/bms/rateLimit";

/** ทั้งสองเมธอดเสิร์ฟ Files panel เดิมที่ /settings และ /admin/files
 *  จึงคงรองรับไฟล์ legacy ที่ tenant_id เป็น null แต่ไฟล์ที่มีเจ้าของต้องถูกจำกัด
 *  ตาม tenant จาก session และ upload ใหม่ต้องผูก tenant เมื่อระบุได้ */
type FileScope = {
  tenantId: string | null;
  rateKey: string;
};

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 1024 * 1024;

async function requireSession(): Promise<FileScope | null> {
  // Admin uploads/listing must use the same acting-tenant authority as every
  // other admin REST route. Keep tenant-less user files working for the legacy
  // Settings panel, but never let that session enumerate another shop's rows.
  if (verifyAdminSession()) {
    const auth = await authorizeAdminRoute(null);
    if (!auth.ok) return null;
    return { tenantId: auth.tenantId, rateKey: `admin:${auth.adminId}` };
  }

  const user = verifyUserSession();
  if (!user) return null;
  return {
    tenantId: user.tenant_id ? String(user.tenant_id) : null,
    rateKey: `user:${String(user.id)}`,
  };
}

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const scope = await requireSession();
  if (!scope) return unauthorized();
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));
  const offset = (page - 1) * pageSize;

  const conditions = [
    "deleted_at IS NULL",
    "filename NOT LIKE '%operation-evidence-%'",
  ];
  const filterArgs: any[] = [];

  if (scope.tenantId) {
    filterArgs.push(scope.tenantId);
    // tenant_id IS NULL preserves the legacy Files panel rows that predate
    // tenant ownership. Rows owned by another tenant are never returned.
    conditions.push(`(tenant_id IS NULL OR tenant_id = $${filterArgs.length})`);
  } else {
    conditions.push("tenant_id IS NULL");
  }

  if (q) {
    filterArgs.push(`%${q}%`);
    conditions.push(
      `(LOWER(original_name) LIKE LOWER($${filterArgs.length}) OR LOWER(filename) LIKE LOWER($${filterArgs.length}))`
    );
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const args = [...filterArgs, pageSize, offset];
  const limitPosition = filterArgs.length + 1;
  const offsetPosition = filterArgs.length + 2;

  const { rows } = await query(
    `SELECT id, filename, original_name, mimetype, size, checksum, created_at, updated_at
       FROM files
       ${where}
       ORDER BY created_at DESC
       LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
    args
  );

  const { rows: [{ count }] } = await query(
    `SELECT COUNT(*)::int AS count FROM files ${where}`,
    filterArgs
  );

  return NextResponse.json({ items: rows, total: count, page, pageSize });
}

// POST multipart upload
async function handlePOST(req: NextRequest) {
  const scope = await requireSession();
  if (!scope) return unauthorized();

  const limited = await rateLimit(`files-upload:${scope.rateKey}`, 20, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "too many uploads" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } }
    );
  }

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "file too large (max 25 MB)" }, { status: 413 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const renameTo = (form.get("name") as string) || undefined;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "file too large (max 25 MB)" }, { status: 413 });
  }

  const row = await persistWebFile(file, renameTo, "private", scope.tenantId);
  const { relpath: _storageKey, ...safeRow } = row;
  return NextResponse.json(safeRow, { status: 201 });
}

export const GET = withRouteErrorLog("GET /api/files", handleGET);
export const POST = withRouteErrorLog("POST /api/files", handlePOST);
