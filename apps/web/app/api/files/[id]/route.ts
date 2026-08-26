import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import path from "path";
import { Readable } from "stream";
import { openStoredFileStream, statStoredFile } from "@/lib/storage";
import { verifyAdminSession, verifyUserSession } from "@/lib/auth/server";
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
};

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
    cleanMime.startsWith("image/") ||
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
      SELECT id, filename, original_name, mimetype, relpath, size, deleted_at, visibility
      FROM files
      WHERE id = $1
        AND deleted_at IS NULL
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

    // ---- visibility (9.26) ----
    // route นี้ไม่เคยตรวจอะไรเลย และ files.id เป็นเลข integer เรียงลำดับ ใครก็ไล่
    // นับขึ้นไปโหลดไฟล์ของคนอื่นได้ · รูปสินค้าหน้าร้านต้องเปิดได้จริงจึงคง public
    // ส่วนสลิปโอนเงิน/ไฟล์แนบ Inbox/รายงาน ถูกตั้งเป็น private และต้องมี session
    //
    // แถวเก่าทั้งหมดถูก backfill เป็น public ตอน migrate เพื่อไม่ให้ของที่ใช้งานอยู่พัง
    // ค่าที่หายไป/ค่าแปลกปลอมถือเป็น private (fail closed) ไม่ใช่ปล่อยผ่าน
    if (String(row.visibility ?? "private") !== "public") {
      const session = verifyAdminSession() ?? verifyUserSession();
      if (!session) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
    const dispositionType =
      mode === "download"
        ? "attachment"
        : mode === "inline"
        ? "inline"
        : shouldInline(mime)
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

export const GET = withRouteErrorLog("GET /api/files/[id]", handleGET);
