import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { getQueueBoardMedia, QueueBoardMediaError } from "@/lib/bms/queueBoardMedia";
import { prepareCustomerDisplayBackground } from "@/lib/bms/storeLogo";
import { buildFileUrlById, persistWebFile } from "@/lib/storage";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("location.manage");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const locationId = req.nextUrl.searchParams.get("locationId") ?? "";
  if (!UUID.test(locationId)) return NextResponse.json({ error: "รหัสสาขาไม่ถูกต้อง" }, { status: 400 });
  const contentLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 6 * 1024 * 1024) {
    return NextResponse.json({ error: "รูปต้องไม่เกิน 5 MB" }, { status: 413 });
  }
  try { await getQueueBoardMedia(auth.tenantId, locationId, String(auth.adminId)); }
  catch (error) {
    if ((error as Error).message === "FORBIDDEN") return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (error instanceof QueueBoardMediaError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !MIMES.has(file.type)) return NextResponse.json({ error: "รองรับเฉพาะภาพ PNG, JPG และ WebP" }, { status: 400 });
  if (!file.size || file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "รูปต้องไม่เกิน 5 MB" }, { status: 413 });
  let normalized: File;
  try {
    const bytes = await prepareCustomerDisplayBackground(Buffer.from(await file.arrayBuffer()));
    normalized = new File([new Uint8Array(bytes)], "queue-board-media.webp", { type: "image/webp" });
  } catch { return NextResponse.json({ error: "อ่านรูปไม่ได้หรือรูปมีขนาดพิกเซลมากเกินไป" }, { status: 400 }); }
  const row = await persistWebFile(normalized, undefined, "public", auth.tenantId);
  return NextResponse.json({ fileId: row.id, url: buildFileUrlById(row.id) });
}

export const POST = withRouteErrorLog("POST /api/bms/queue-board/media/upload", handlePOST);
