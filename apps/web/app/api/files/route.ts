// apps/web/app/api/files/route.ts
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { persistWebFile } from "@/lib/storage";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { verifyAdminSession, verifyUserSession } from "@/lib/auth/server";

/** ทั้งสองเมธอดในไฟล์นี้เสิร์ฟ Files panel ที่ /settings ซึ่งเมนูถูกคอมเมนต์ปิดไปแล้ว
 *  แต่ route ยังเปิดโล่งอยู่: GET ไล่รายชื่อไฟล์ทั้งระบบพร้อม relpath ได้โดยไม่ต้องล็อกอิน
 *  และ POST อัปโหลดไฟล์เข้าเซิร์ฟเวอร์ได้โดยไม่ต้องล็อกอิน (9.26) */
function requireSession() {
  return verifyAdminSession() ?? verifyUserSession();
}
const UNAUTHORIZED = NextResponse.json({ error: "unauthorized" }, { status: 401 });

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  // รายชื่อไฟล์ทั้งระบบรวม relpath = แผนที่ให้ไล่เดา ต้องล็อกอินก่อน
  if (!requireSession()) return UNAUTHORIZED;
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));
  const offset = (page - 1) * pageSize;

  const where = q
    ? "WHERE deleted_at IS NULL AND (LOWER(original_name) LIKE LOWER($1) OR LOWER(filename) LIKE LOWER($1))"
    : "WHERE deleted_at IS NULL";
  const args: any[] = q ? [`%${q}%`, pageSize, offset] : [pageSize, offset];

  const { rows } = await query(
    `SELECT id, filename, original_name, mimetype, size, checksum, relpath, created_at, updated_at
       FROM files
       ${where}
       ORDER BY created_at DESC
       LIMIT $${q ? 2 : 1} OFFSET $${q ? 3 : 2}`,
    args
  );

  const { rows: [{ count }] } = await query(
    `SELECT COUNT(*)::int AS count FROM files ${q ? "WHERE deleted_at IS NULL AND (LOWER(original_name) LIKE LOWER($1) OR LOWER(filename) LIKE LOWER($1))" : "WHERE deleted_at IS NULL"}`,
    q ? [`%${q}%`] : []
  );

  return NextResponse.json({ items: rows, total: count, page, pageSize });
}

// POST multipart upload
async function handlePOST(req: NextRequest) {
  if (!requireSession()) return UNAUTHORIZED;
  const form = await req.formData();
  const file = form.get("file");
  const renameTo = (form.get("name") as string) || undefined;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const row = await persistWebFile(file, renameTo);
  return NextResponse.json(row, { status: 201 });
}

export const GET = withRouteErrorLog("GET /api/files", handleGET);
export const POST = withRouteErrorLog("POST /api/files", handlePOST);
