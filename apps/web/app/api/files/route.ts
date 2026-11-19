// apps/web/app/api/files/route.ts
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { persistWebFile } from "@/lib/storage";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { verifyAdminSession, verifyUserSession } from "@/lib/auth/server";
import { authorizePlatformAdminRoute } from "@/lib/bms/adminRouteAuth";
import { rateLimit } from "@/lib/bms/rateLimit";

/** ทั้งสองเมธอดเสิร์ฟ Files panel เดิมที่ /settings และ /admin/files
 *  Platform admin ดู inventory ทั้งระบบ ส่วนผู้ใช้เว็บเห็นเฉพาะไฟล์ที่ session
 *  ของตนเป็นเจ้าของ — tenant เดียวกันอย่างเดียวไม่ใช่สิทธิ์ดูไฟล์ส่วนตัว */
type FileScope =
  | {
      kind: "platform";
      actorId: string;
      tenantId: null;
      rateKey: string;
    }
  | {
      kind: "user";
      actorId: string;
      tenantId: string | null;
      rateKey: string;
    };

type FileScopeResult = {
  scope: FileScope | null;
  status: 401 | 403;
};

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 1024 * 1024;

async function requireSession(): Promise<FileScopeResult> {
  // `/admin/files` is a platform operational surface.  Its GraphQL side uses
  // the same boundary; a shop Administrator must not enumerate global files.
  if (verifyAdminSession()) {
    const auth = await authorizePlatformAdminRoute();
    if (auth.ok) {
      return {
        scope: {
          kind: "platform",
          actorId: String(auth.adminId),
          tenantId: null,
          rateKey: `admin:${auth.adminId}`,
        },
        status: 401,
      };
    }

    // A browser may hold both cookies. Falling back to the strictly owner-
    // scoped web session is safe and keeps `/settings` usable.
    const fallbackUser = verifyUserSession();
    if (!fallbackUser) return { scope: null, status: auth.status };
  }

  const user = verifyUserSession();
  if (!user) return { scope: null, status: 401 };
  return {
    scope: {
      kind: "user",
      actorId: String(user.id),
      tenantId: user.tenant_id ? String(user.tenant_id) : null,
      rateKey: `user:${String(user.id)}`,
    },
    status: 401,
  };
}

function authError(status: 401 | 403) {
  return NextResponse.json(
    { error: status === 401 ? "unauthorized" : "forbidden" },
    { status }
  );
}

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.scope) return authError(auth.status);
  const scope = auth.scope;
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

  if (scope.kind === "user") {
    filterArgs.push(scope.actorId);
    conditions.push(`owner_user_id = $${filterArgs.length}::uuid`);
    // Settings is a personal scratch-file panel, not an alternate editor for
    // posts, chat history or avatars. Those features own their referenced rows.
    conditions.push("NOT EXISTS (SELECT 1 FROM post_images pi WHERE pi.file_id = files.id)");
    conditions.push("NOT EXISTS (SELECT 1 FROM message_images mi WHERE mi.file_id = files.id)");
    conditions.push("NOT EXISTS (SELECT 1 FROM messages m WHERE m.audio_file_id = files.id)");
    conditions.push(
      "NOT EXISTS (SELECT 1 FROM users u WHERE u.avatar = '/api/files/' || files.id::text OR u.avatar LIKE '/api/files/' || files.id::text || '?%')"
    );
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
  const auth = await requireSession();
  if (!auth.scope) return authError(auth.status);
  const scope = auth.scope;

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

  const row = await persistWebFile(
    file,
    renameTo,
    "private",
    scope.tenantId,
    scope.actorId
  );
  const { relpath: _storageKey, ...safeRow } = row;
  return NextResponse.json(safeRow, { status: 201 });
}

export const GET = withRouteErrorLog("GET /api/files", handleGET);
export const POST = withRouteErrorLog("POST /api/files", handlePOST);
