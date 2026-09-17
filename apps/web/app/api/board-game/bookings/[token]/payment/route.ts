import { NextRequest, NextResponse } from "next/server";
import sharp, { type Metadata } from "sharp";
import {
  getPublicBoardGameReservationUploadContext,
  submitPublicBoardGameReservationDeposit,
} from "@/lib/bms/boardGameWaitlist";
import { rateLimit } from "@/lib/bms/rateLimit";
import { buildFileUrlById, persistWebFile } from "@/lib/storage";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SLIP_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_SLIP_BYTES + 1024 * 1024;
const MAX_SLIP_PIXELS = 24_000_000;
const SLIP_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SLIP_FORMATS = new Set(["jpeg", "png", "webp"]);

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function handlePOST(req: NextRequest, { params }: { params: { token: string } }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = await rateLimit(`board-game-public-booking-payment:${ip}`, 10, 60 * 60_000);
  if (!limited.ok) {
    return response({ error: "ส่งข้อมูลมากเกินไป กรุณาลองใหม่ภายหลัง" }, 429);
  }
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) return response({ error: "รูปสลิปต้องมีขนาดไม่เกิน 8 MB" }, 413);

  const form = await req.formData().catch(() => null);
  if (!form) return response({ error: "ข้อมูลที่ส่งมาไม่ถูกต้อง" }, 400);
  const method = String(form.get("method") || "").toUpperCase();
  const slipRef = String(form.get("slipRef") || "").trim() || null;
  const file = form.get("slip");
  if (method !== "BANK_TRANSFER" && method !== "QR") {
    return response({ error: "ช่องทางชำระเงินไม่ถูกต้อง" }, 400);
  }
  if (!(file instanceof File) || file.size === 0) return response({ error: "กรุณาแนบรูปสลิป" }, 400);
  if (!SLIP_TYPES.has(file.type)) return response({ error: "รองรับสลิป JPG, PNG หรือ WEBP เท่านั้น" }, 400);
  if (file.size > MAX_SLIP_BYTES) return response({ error: "รูปสลิปต้องมีขนาดไม่เกิน 8 MB" }, 400);

  try {
    let metadata: Metadata;
    try {
      metadata = await sharp(Buffer.from(await file.arrayBuffer()), {
        limitInputPixels: MAX_SLIP_PIXELS,
      }).metadata();
    } catch {
      return response({ error: "ไฟล์สลิปไม่ใช่รูปภาพที่รองรับ" }, 400);
    }
    if (!metadata.format || !SLIP_FORMATS.has(metadata.format) || !metadata.width || !metadata.height) {
      return response({ error: "ไฟล์สลิปไม่ใช่รูปภาพที่รองรับ" }, 400);
    }
    const owner = await getPublicBoardGameReservationUploadContext(params.token);
    if (owner.depositStatus === "SUBMITTED") {
      return response(await submitPublicBoardGameReservationDeposit({
        token: params.token, method, slipUrl: "", slipRef,
      }));
    }
    const stored = await persistWebFile(
      file,
      `board-game-reservation-${owner.reservationId}-${file.name}`,
      "private",
      owner.tenantId,
    );
    const result = await submitPublicBoardGameReservationDeposit({
      token: params.token,
      method,
      slipUrl: buildFileUrlById(stored.id),
      slipRef,
    });
    return response(result, result.status === "SUBMITTED" ? 201 : 200);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "แจ้งชำระไม่สำเร็จ" }, 400);
  }
}

export const POST = withRouteErrorLog("POST /api/board-game/bookings/[token]/payment", handlePOST);
