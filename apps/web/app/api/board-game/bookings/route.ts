import { NextRequest, NextResponse } from "next/server";
import { requestPublicBoardGameReservation } from "@/lib/bms/boardGameWaitlist";
import { rateLimit } from "@/lib/bms/rateLimit";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = await rateLimit(`board-game-public-booking:${ip}`, 10, 60 * 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: "ส่งคำขอมากเกินไป กรุณาลองใหม่ภายหลัง" }, {
      status: 429, headers: { "retry-after": String(limited.retryAfter) },
    });
  }
  try {
    const body = await req.json();
    const reservation = await requestPublicBoardGameReservation(body);
    return NextResponse.json({ reservation }, {
      status: 201, headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "ส่งคำขอจองไม่สำเร็จ",
    }, { status: 400 });
  }
}

export const POST = withRouteErrorLog("POST /api/board-game/bookings", handlePOST);
