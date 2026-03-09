import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import fs from "fs";
import path from "path";
import { STORAGE_DIR } from "@/lib/storage";

export const dynamic = "force-dynamic";

type FileRow = {
  id?: number;
  filename: string | null;
  original_name: string | null;
  mimetype: string | null;
  relpath: string;
  size?: number | null;
  deleted_at?: string | null;
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

export async function GET(
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
      SELECT id, filename, original_name, mimetype, relpath, size, deleted_at
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

    const fullPath = path.join(STORAGE_DIR, row.relpath);

    if (!fs.existsSync(fullPath)) {
      return NextResponse.json(
        { error: "file missing on disk" },
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

    const fileBuffer = await fs.promises.readFile(fullPath);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(fileBuffer.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Disposition":
          `${dispositionType}; filename="${downloadName}"; ` +
          `filename*=UTF-8''${encodeURIComponent(downloadName)}`,
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