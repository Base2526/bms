import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { query } from "@/lib/db";
import { openStoredFileStream, statStoredFile } from "@/lib/storage";
import { verifyInboxMedia } from "@/lib/bms/inboxMedia";
import { rateLimit } from "@/lib/bms/rateLimit";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = await rateLimit(`inbox-media:${ip}`, 300, 60_000);
  if (!limit.ok) return NextResponse.json({ error: "too many requests" }, { status: 429,
    headers: { "Retry-After": String(limit.retryAfter) } });
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "not found" }, { status: 404 });
  const signed = verifyInboxMedia(req.nextUrl.searchParams.get("token"));
  if (!signed || signed.fileId !== id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const result = await query<{ relpath: string; mimetype: string | null; original_name: string | null }>(
    `SELECT relpath,mimetype,original_name FROM files
      WHERE id=$1 AND tenant_id=$2 AND visibility='private' AND deleted_at IS NULL
        AND filename LIKE 'bms-inbox-%' LIMIT 1`,
    [id, signed.tenantId]
  );
  const file = result.rows[0];
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
  const stored = await statStoredFile(file.relpath);
  if (!stored) return NextResponse.json({ error: "not found" }, { status: 404 });
  const mime = String(file.mimetype || "application/octet-stream").split(";", 1)[0].trim().toLowerCase();
  const inline = ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mime);
  const filename = String(file.original_name || `inbox-${id}`)
    .replace(/[\r\n"\\/]/g, "_").slice(0, 180);
  const stream = await openStoredFileStream(file.relpath);
  return new NextResponse(Readable.toWeb(stream) as any, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(stored.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const GET = withRouteErrorLog("GET /api/bms/inbox/media/[id]", handleGET);
