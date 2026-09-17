import { NextRequest, NextResponse } from "next/server";
import {
  cancelPublicBoardGameReservation,
  getPublicBoardGameReservation,
} from "@/lib/bms/boardGameWaitlist";
import { rateLimit } from "@/lib/bms/rateLimit";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return rateLimit(`board-game-public-booking-manage:${ip}`, 30, 60_000);
}

async function handleGET(req: NextRequest, { params }: { params: { token: string } }) {
  const limited = await guard(req);
  if (!limited.ok) return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
  try {
    return NextResponse.json({ reservation: await getPublicBoardGameReservation(params.token) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "ไม่พบคำขอจอง" }, { status: 404 });
  }
}

async function handlePATCH(req: NextRequest, { params }: { params: { token: string } }) {
  const limited = await guard(req);
  if (!limited.ok) return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
  try {
    const body = await req.json();
    if (String(body?.action).toUpperCase() !== "CANCEL") {
      return NextResponse.json({ error: "รองรับเฉพาะการยกเลิก" }, { status: 400 });
    }
    return NextResponse.json({ reservation: await cancelPublicBoardGameReservation(params.token) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "ยกเลิกไม่สำเร็จ" }, { status: 400 });
  }
}

export const GET = withRouteErrorLog("GET /api/board-game/bookings/[token]", handleGET);
export const PATCH = withRouteErrorLog("PATCH /api/board-game/bookings/[token]", handlePATCH);
