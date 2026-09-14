import { NextRequest, NextResponse } from "next/server";
import { listPublicBoardGameCafes } from "@/lib/bms/boardGameCafe";
import { rateLimit } from "@/lib/bms/rateLimit";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function optionalNumber(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

async function handleGET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await rateLimit(`board-game-nearby:${ip}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate limit exceeded" },
      { status: 429, headers: { "retry-after": String(rl.retryAfter) } }
    );
  }
  const latitude = optionalNumber(req.nextUrl.searchParams.get("lat"));
  const longitude = optionalNumber(req.nextUrl.searchParams.get("lng"));
  if ((latitude == null) !== (longitude == null)) {
    return NextResponse.json({ error: "lat and lng must be provided together" }, { status: 400 });
  }
  try {
    const cafes = await listPublicBoardGameCafes({
      latitude,
      longitude,
      radiusKm: optionalNumber(req.nextUrl.searchParams.get("radiusKm")),
      limit: optionalNumber(req.nextUrl.searchParams.get("limit")),
    });
    return NextResponse.json({ cafes });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to search board-game cafes" },
      { status: 400 }
    );
  }
}

export const GET = withRouteErrorLog("GET /api/board-game/nearby", handleGET);
