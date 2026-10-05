import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { BOARD_GAME_IMAGE_MAX_BYTES, setBoardGameTitleImage } from "@/lib/bms/boardGameLibraryMedia";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  const auth = await authorizeAdminRoute("board_game.library.manage");
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  const titleId = req.nextUrl.searchParams.get("titleId") ?? "";
  try {
    let bytes: Buffer | null = null;
    if (req.method !== "DELETE") {
      if (!["image/jpeg", "image/png", "image/webp"].includes(req.headers.get("content-type") ?? "")) {
        return NextResponse.json({ error: "รองรับภาพนิ่ง PNG, JPG และ WebP เท่านั้น" }, { status: 400 });
      }
      if (Number(req.headers.get("content-length")) > BOARD_GAME_IMAGE_MAX_BYTES) {
        return NextResponse.json({ error: "รูปเกมต้องไม่เกิน 5MB" }, { status: 413 });
      }
      const reader = req.body?.getReader();
      if (!reader) return NextResponse.json({ error: "ไม่พบไฟล์" }, { status: 400 });
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > BOARD_GAME_IMAGE_MAX_BYTES) {
            await reader.cancel();
            return NextResponse.json({ error: "รูปเกมต้องไม่เกิน 5MB" }, { status: 413 });
          }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      bytes = Buffer.concat(chunks);
    }
    return NextResponse.json(await setBoardGameTitleImage(auth.tenantId, titleId, bytes, String(auth.adminId)));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "บันทึกรูปไม่สำเร็จ" }, { status: 400 });
  }
}
export const POST = withRouteErrorLog("POST /api/bms/board-game/library/image", handle);
export const DELETE = withRouteErrorLog("DELETE /api/bms/board-game/library/image", handle);
