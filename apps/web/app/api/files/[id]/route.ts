import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import path from "path";
import { Readable } from "stream";
import { openStoredFileStream, statStoredFile } from "@/lib/storage";
import { verifyUserSession } from "@/lib/auth/server";
import {
  authorizeAdminRoute,
  authorizePlatformAdminRoute,
} from "@/lib/bms/adminRouteAuth";
import { findGeneratedReportByFileId } from "@/lib/bms/reportEngine";
import { requirePermission } from "@/lib/bms/permissions";
import { canAccessInboxConversation } from "@/lib/bms/inbox";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

type FileRow = {
  id?: number;
  filename: string | null;
  original_name: string | null;
  mimetype: string | null;
  relpath: string;
  size?: number | null;
  deleted_at?: string | null;
  visibility?: string | null;
  tenant_id?: string | null;
  owner_user_id?: string | null;
  is_chat_file?: boolean;
  is_community_reference?: boolean;
  is_pharmacy_evidence?: boolean;
  is_operation_evidence?: boolean;
  is_delivery_dispute_evidence?: boolean;
  is_support_bundle?: boolean;
  is_release_asset?: boolean;
};

const BLOCKED_GENERIC_EXTENSIONS = new Set([
  ".env", ".sql", ".sqlite", ".sqlite3", ".db", ".dump",
  ".keystore", ".jks", ".pem", ".key", ".p12", ".pfx",
  ".crt", ".cer", ".log", ".bak", ".sh", ".ps1", ".bat",
  ".cmd", ".pkg", ".deb", ".exe", ".msi", ".dmg",
]);

function isBlockedGenericDownload(row: FileRow): boolean {
  const names = [row.original_name, row.filename, row.relpath]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  return names.some(
    (name) =>
      name.includes("../") ||
      name.includes("..\\") ||
      BLOCKED_GENERIC_EXTENSIONS.has(path.extname(name))
  );
}

async function actorIdsForFileRequest(): Promise<string[]> {
  const ids = new Set<string>();
  const user = verifyUserSession();
  if (user?.id) ids.add(String(user.id));
  const admin = await authorizeAdminRoute(null);
  if (admin.ok) ids.add(String(admin.adminId));
  return [...ids];
}

async function canReadChatFile(fileId: number, actorIds: string[]): Promise<boolean> {
  if (!actorIds.length) return false;
  const result = await query(
    `SELECT 1
       FROM chat_members cm
      WHERE cm.user_id::text = ANY($2::text[])
        AND cm.chat_id IN (
          SELECT m.chat_id
            FROM message_images mi
            JOIN messages m ON m.id = mi.message_id
           WHERE mi.file_id = $1
          UNION
          SELECT m.chat_id FROM messages m WHERE m.audio_file_id = $1
        )
      LIMIT 1`,
    [fileId, actorIds]
  );
  return Boolean(result.rowCount);
}

function guessMimeFromName(name: string): string {
  const ext = path.extname(name || "").toLowerCase();

  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".ico") return "image/x-icon";

  if (ext === ".pdf") return "application/pdf";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  if (ext === ".csv") return "text/csv; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".xml") return "application/xml; charset=utf-8";

  if (ext === ".zip") return "application/zip";
  if (ext === ".rar") return "application/vnd.rar";
  if (ext === ".7z") return "application/x-7z-compressed";
  if (ext === ".tar") return "application/x-tar";
  if (ext === ".gz") return "application/gzip";

  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".avi") return "video/x-msvideo";
  if (ext === ".webm") return "video/webm";

  if (ext === ".doc") return "application/msword";
  if (ext === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  if (ext === ".xls") return "application/vnd.ms-excel";
  if (ext === ".xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }

  if (ext === ".ppt") return "application/vnd.ms-powerpoint";
  if (ext === ".pptx") {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }

  return "";
}

function guessExtFromMime(mime: string): string {
  const cleanMime = (mime || "").split(";")[0].trim().toLowerCase();

  if (cleanMime === "image/png") return ".png";
  if (cleanMime === "image/jpeg") return ".jpg";
  if (cleanMime === "image/gif") return ".gif";
  if (cleanMime === "image/webp") return ".webp";
  if (cleanMime === "image/svg+xml") return ".svg";
  if (cleanMime === "image/bmp") return ".bmp";
  if (cleanMime === "image/x-icon") return ".ico";

  if (cleanMime === "application/pdf") return ".pdf";
  if (cleanMime === "text/plain") return ".txt";
  if (cleanMime === "text/csv") return ".csv";
  if (cleanMime === "application/json") return ".json";
  if (cleanMime === "application/xml") return ".xml";

  if (cleanMime === "application/zip") return ".zip";
  if (cleanMime === "application/vnd.rar") return ".rar";
  if (cleanMime === "application/x-7z-compressed") return ".7z";
  if (cleanMime === "application/x-tar") return ".tar";
  if (cleanMime === "application/gzip") return ".gz";

  if (cleanMime === "audio/mpeg") return ".mp3";
  if (cleanMime === "audio/wav") return ".wav";
  if (cleanMime === "video/mp4") return ".mp4";
  if (cleanMime === "video/quicktime") return ".mov";
  if (cleanMime === "video/x-msvideo") return ".avi";
  if (cleanMime === "video/webm") return ".webm";

  if (cleanMime === "application/msword") return ".doc";
  if (
    cleanMime ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return ".docx";
  }

  if (cleanMime === "application/vnd.ms-excel") return ".xls";
  if (
    cleanMime ===
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return ".xlsx";
  }

  if (cleanMime === "application/vnd.ms-powerpoint") return ".ppt";
  if (
    cleanMime ===
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return ".pptx";
  }

  return "";
}

function sanitizeFilename(name: string): string {
  return (name || "download")
    .replace(/[\/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDownloadName(row: FileRow, id: number, mime: string): string {
  let name =
    (row.original_name || "").trim() ||
    (row.filename || "").trim() ||
    path.basename(row.relpath || "").trim() ||
    `file-${id}`;

  name = sanitizeFilename(name);

  if (!path.extname(name)) {
    const ext = guessExtFromMime(mime);
    if (ext) {
      name += ext;
    }
  }

  return name || `file-${id}`;
}

function shouldInline(mime: string): boolean {
  const cleanMime = (mime || "").split(";")[0].trim().toLowerCase();

  return (
    (cleanMime.startsWith("image/") && cleanMime !== "image/svg+xml") ||
    cleanMime === "application/pdf" ||
    cleanMime === "text/plain" ||
    cleanMime === "text/csv" ||
    cleanMime === "application/json"
  );
}

async function handleGET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = Number(params.id);

    if (!id || Number.isNaN(id)) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }

    const { rows } = await query(
      `
      SELECT f.id, f.filename, f.original_name, f.mimetype, f.relpath, f.size,
             f.deleted_at, f.visibility, f.tenant_id, f.owner_user_id,
             EXISTS (
               SELECT 1 FROM message_images mi WHERE mi.file_id = f.id
               UNION ALL
               SELECT 1 FROM messages m WHERE m.audio_file_id = f.id
             ) AS is_chat_file,
             (
               EXISTS (SELECT 1 FROM post_images pi WHERE pi.file_id = f.id)
               OR EXISTS (SELECT 1 FROM message_images mi WHERE mi.file_id = f.id)
               OR EXISTS (SELECT 1 FROM messages m WHERE m.audio_file_id = f.id)
               OR EXISTS (
                 SELECT 1 FROM users u
                  WHERE u.avatar = '/api/files/' || f.id::text
                     OR u.avatar LIKE '/api/files/' || f.id::text || '?%'
               )
             ) AS is_community_reference,
             EXISTS (
               SELECT 1 FROM bms_pharmacy_clinical_evidence e WHERE e.file_id = f.id
             ) AS is_pharmacy_evidence,
             EXISTS (
               SELECT 1 FROM bms_operation_evidence e WHERE e.file_id = f.id
             ) AS is_operation_evidence,
             EXISTS (
               SELECT 1 FROM bms_delivery_dispute_evidence e WHERE e.file_id = f.id
             ) AS is_delivery_dispute_evidence,
             EXISTS (
               SELECT 1 FROM bms_support_bundles b WHERE b.file_id = f.id
             ) AS is_support_bundle,
             EXISTS (
               SELECT 1 FROM bms_retail_local_release_assets a WHERE a.file_id = f.id
             ) AS is_release_asset
      FROM files f
      WHERE f.id = $1
        AND f.deleted_at IS NULL
      LIMIT 1
      `,
      [id]
    );

    const row = rows?.[0] as FileRow | undefined;

    if (!row) {
      return NextResponse.json({ error: "file not found" }, { status: 404 });
    }

    if (!row.relpath) {
      return NextResponse.json({ error: "file path missing" }, { status: 404 });
    }

    // These categories have dedicated routes with narrower RBAC/signature
    // checks. The generic sequential-id route must never be an alternate path.
    if (
      row.filename?.includes("operation-evidence-") ||
      row.filename?.includes("delivery-dispute-evidence-") ||
      row.filename?.includes("bank-statement-") ||
      row.is_pharmacy_evidence ||
      row.is_operation_evidence ||
      row.is_delivery_dispute_evidence ||
      row.is_support_bundle ||
      row.is_release_asset ||
      isBlockedGenericDownload(row)
    ) {
      return NextResponse.json({ error: 'file not found' }, { status: 404 });
    }

    // Chat media is private by membership even if a rollout has not yet run
    // 10.109 and the legacy row still says `public`.
    let actorIds: string[] | null = null;
    if (row.is_chat_file) {
      actorIds = await actorIdsForFileRequest();
      if (!actorIds.length) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      if (!(await canReadChatFile(id, actorIds))) {
        return NextResponse.json({ error: "file not found" }, { status: 404 });
      }
    }

    // ---- visibility (9.26) ----
    // route นี้ไม่เคยตรวจอะไรเลย และ files.id เป็นเลข integer เรียงลำดับ ใครก็ไล่
    // นับขึ้นไปโหลดไฟล์ของคนอื่นได้ · รูปสินค้าหน้าร้านต้องเปิดได้จริงจึงคง public
    // ส่วนสลิปโอนเงิน/ไฟล์แนบ Inbox/รายงาน ถูกตั้งเป็น private และต้องมี session
    //
    // แถวเก่าทั้งหมดถูก backfill เป็น public ตอน migrate เพื่อไม่ให้ของที่ใช้งานอยู่พัง
    // ค่าที่หายไป/ค่าแปลกปลอมถือเป็น private (fail closed) ไม่ใช่ปล่อยผ่าน
    if (String(row.visibility ?? "private") !== "public") {
      actorIds ??= await actorIdsForFileRequest();
      const ownerMatch =
        Boolean(row.owner_user_id) && actorIds.includes(String(row.owner_user_id));

      // Inbox uploads are sequentially addressable files. A tenant match alone
      // must not let an unrelated staff member read another conversation.
      if (row.filename?.startsWith("bms-inbox-")) {
        const auth = await authorizeAdminRoute("inbox.view");
        if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "file not found" },
          { status: auth.status === 401 ? 401 : 404 });
        if (String(auth.tenantId) !== String(row.tenant_id))
          return NextResponse.json({ error: "file not found" }, { status: 404 });
        const linked = await query<{ conversation_id: string }>(
          `SELECT m.conversation_id FROM bms_messages m
            WHERE m.tenant_id=$1 AND (
              m.meta->'attachment'->>'url'=$2 OR
              m.meta->'attachment'->>'url' LIKE $3
            ) LIMIT 1`,
          [auth.tenantId, `/api/files/${id}`, `/api/bms/inbox/media/${id}?token=%`]
        );
        if (!linked.rowCount && !ownerMatch)
          return NextResponse.json({ error: "file not found" }, { status: 404 });
        if (linked.rowCount && auth.admin.role === "Sales" &&
            !(await canAccessInboxConversation(auth.tenantId, linked.rows[0].conversation_id, String(auth.adminId))))
          return NextResponse.json({ error: "file not found" }, { status: 404 });
      }

      // A chat membership or the exact user owner is sufficient. Tenant-owned
      // BMS files continue through their tenant/RBAC checks below.
      if (row.is_chat_file || ownerMatch) {
        // authorized above
      } else if (row.tenant_id) {
        // ไฟล์ที่มีเจ้าของ (9.27) ต้องเป็นร้านเดียวกับที่ล็อกอินอยู่ — เดิมแค่ล็อกอิน
        // ร้านไหนก็เปิดไฟล์ private ของร้านอื่นได้ถ้าเดา id ถูก · acting tenant มาจาก
        // authorizeAdminRoute เพื่อให้ผ่านคุกกี้ drill-down ที่เซ็นแล้วด้วย ไม่ใช่
        // อ่าน tenant_id จาก session ตรง ๆ ซึ่งจะพลาดเคส platform admin
        const auth = await authorizeAdminRoute(null);
        if (!auth.ok) {
          return NextResponse.json(
            { error: auth.status === 401 ? "unauthorized" : "forbidden" },
            { status: auth.status }
          );
        }
        if (String(auth.tenantId) !== String(row.tenant_id)) {
          // 404 ไม่ใช่ 403 — ไม่บอกคนนอกร้านว่า id นี้มีไฟล์อยู่จริง
          return NextResponse.json({ error: "file not found" }, { status: 404 });
        }

        // Generated reports have a narrower contract than ordinary tenant-private files. In
        // particular VAT_SALES can contain buyer tax identity and carries branch scope in
        // bms_generated_reports.params. Without this recognition, changing the documented
        // /api/bms/reports/download/{id} URL to /api/files/{id} bypasses every report guard.
        const generated = await query(
          `SELECT 1 FROM bms_generated_reports WHERE tenant_id = $1 AND file_id = $2 LIMIT 1`,
          [auth.tenantId, id]
        );
        if (generated.rowCount) {
          try {
            await requirePermission(auth.ctx, "report.view");
          } catch {
            return NextResponse.json({ error: "file not found" }, { status: 404 });
          }
          if (!(await findGeneratedReportByFileId(auth.tenantId, id, auth.ctx))) {
            return NextResponse.json({ error: "file not found" }, { status: 404 });
          }
        }
      } else {
        // Ownerless private legacy rows are operational artifacts, not shared
        // community content. Only the platform file inventory may open them.
        const auth = await authorizePlatformAdminRoute();
        if (!auth.ok) {
          return NextResponse.json(
            { error: auth.status === 401 ? "unauthorized" : "file not found" },
            { status: auth.status === 401 ? 401 : 404 }
          );
        }
      }
    }

    const stored = await statStoredFile(row.relpath);

    if (!stored) {
      return NextResponse.json(
        { error: "file missing in storage" },
        { status: 404 }
      );
    }

    let mime = (row.mimetype || "").trim().toLowerCase();

    if (!mime || mime === "application/octet-stream") {
      mime =
        guessMimeFromName(row.original_name || "") ||
        guessMimeFromName(row.filename || "") ||
        guessMimeFromName(row.relpath || "") ||
        "application/octet-stream";
    }

    const downloadName = buildDownloadName(row, id, mime);

    const mode = req.nextUrl.searchParams.get("mode");
    const inlineSafe = shouldInline(mime);
    const dispositionType =
      mode === "download"
        ? "attachment"
        : mode === "inline" && inlineSafe
        ? "inline"
        : inlineSafe
        ? "inline"
        : "attachment";

    const size = stored.size;
    const range = req.headers.get("range");

    const baseHeaders: Record<string, string> = {
      "Content-Type": mime,
      "Cache-Control": String(row.visibility ?? "private") === "public"
        ? "public, max-age=31536000, immutable"
        : "private, no-store, max-age=0",
      "Content-Disposition":
        `${dispositionType}; filename="${downloadName}"; ` +
        `filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
    };

    if (range && /^bytes=\d*-\d*$/i.test(range)) {
      const [startStr, endStr] = range.replace(/bytes=/i, "").split("-");
      const start = startStr ? Math.max(0, parseInt(startStr, 10)) : 0;
      const end = endStr ? Math.min(size - 1, parseInt(endStr, 10)) : size - 1;

      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            ...baseHeaders,
            "Content-Range": `bytes */${size}`,
          },
        });
      }

      const chunkSize = end - start + 1;
      const nodeStream = await openStoredFileStream(row.relpath, { start, end });
      const webStream = Readable.toWeb(nodeStream) as any;

      return new NextResponse(webStream, {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Length": String(chunkSize),
          "Content-Range": `bytes ${start}-${end}/${size}`,
        },
      });
    }

    const nodeStream = await openStoredFileStream(row.relpath);
    const webStream = Readable.toWeb(nodeStream) as any;

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        ...baseHeaders,
        "Content-Length": String(size),
      },
    });
  } catch (error) {
    console.error("GET /api/files/[id] error:", error);
    return NextResponse.json(
      { error: "internal server error" },
      { status: 500 }
    );
  }
}

type ManageFileAuth =
  | { ok: true; platform: boolean; actorId: string }
  | { ok: false; status: 401 | 403 };

async function authorizeFileManagement(): Promise<ManageFileAuth> {
  const platform = await authorizePlatformAdminRoute();
  if (platform.ok) {
    return { ok: true, platform: true, actorId: String(platform.adminId) };
  }

  const user = verifyUserSession();
  if (user?.id) {
    return { ok: true, platform: false, actorId: String(user.id) };
  }
  return { ok: false, status: platform.status };
}

async function managedFileRow(id: number) {
  return query<{
    id: number;
    filename: string;
    original_name: string | null;
    mimetype: string | null;
    size: number;
    checksum: string;
    created_at: string;
    updated_at: string;
    owner_user_id: string | null;
    is_community_reference: boolean;
  }>(
    `SELECT f.id, f.filename, f.original_name, f.mimetype, f.size, f.checksum,
            f.created_at, f.updated_at, f.owner_user_id,
            (
              EXISTS (SELECT 1 FROM post_images pi WHERE pi.file_id = f.id)
              OR EXISTS (SELECT 1 FROM message_images mi WHERE mi.file_id = f.id)
              OR EXISTS (SELECT 1 FROM messages m WHERE m.audio_file_id = f.id)
              OR EXISTS (
                SELECT 1 FROM users u
                 WHERE u.avatar = '/api/files/' || f.id::text
                    OR u.avatar LIKE '/api/files/' || f.id::text || '?%'
              )
            ) AS is_community_reference
       FROM files f
      WHERE f.id = $1 AND f.deleted_at IS NULL
      LIMIT 1`,
    [id]
  );
}

function managementDenied(status: 401 | 403) {
  return NextResponse.json(
    { error: status === 401 ? "unauthorized" : "forbidden" },
    { status }
  );
}

async function handlePATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authorizeFileManagement();
  if (!auth.ok) return managementDenied(auth.status);

  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const name = String(body?.name || "").normalize("NFKC").trim();
  if (!name || name.length > 180 || /[\u0000-\u001f\u007f]/.test(name)) {
    return NextResponse.json({ error: "invalid name" }, { status: 400 });
  }

  const current = (await managedFileRow(id)).rows[0];
  if (!current) return NextResponse.json({ error: "file not found" }, { status: 404 });
  if (
    !auth.platform &&
    (String(current.owner_user_id || "") !== auth.actorId || current.is_community_reference)
  ) {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }

  const result = await query(
    `UPDATE files
        SET original_name = $1, updated_at = NOW()
      WHERE id = $2 AND deleted_at IS NULL
      RETURNING id, filename, original_name, mimetype, size, checksum, created_at, updated_at`,
    [name, id]
  );
  return result.rows[0]
    ? NextResponse.json(result.rows[0])
    : NextResponse.json({ error: "file not found" }, { status: 404 });
}

async function handleDELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authorizeFileManagement();
  if (!auth.ok) return managementDenied(auth.status);

  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const current = (await managedFileRow(id)).rows[0];
  if (!current) return NextResponse.json({ error: "file not found" }, { status: 404 });
  if (
    !auth.platform &&
    (String(current.owner_user_id || "") !== auth.actorId || current.is_community_reference)
  ) {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }

  const result = await query(
    `UPDATE files SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return result.rowCount
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "file not found" }, { status: 404 });
}

export const GET = withRouteErrorLog("GET /api/files/[id]", handleGET);
export const PATCH = withRouteErrorLog("PATCH /api/files/[id]", handlePATCH);
export const DELETE = withRouteErrorLog("DELETE /api/files/[id]", handleDELETE);
