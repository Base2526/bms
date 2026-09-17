import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { BoardGameGuestError } from "@/lib/bms/boardGameServiceCalls";
import { rateLimit } from "@/lib/bms/rateLimit";

export function boardGameGuestToken(req: NextRequest) {
  return req.headers.get("x-bms-board-game-guest") ?? "";
}

export async function requireBoardGameGuestRateLimit(
  req: NextRequest,
  scope: string,
  limit: number
) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const token = boardGameGuestToken(req);
  const digest = token
    ? createHash("sha256").update(token).digest("hex")
    : "none";
  for (const [suffix, value, ceiling] of [
    ["ip", ip, limit * 3],
    ["token", digest, limit],
  ] as const) {
    const result = await rateLimit(
      `board-game-guest:${scope}:${suffix}:${value}`,
      ceiling,
      60_000
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: "มีคำขอเข้ามาเร็วเกินไป กรุณารอสักครู่แล้วลองใหม่" },
        { status: 429, headers: { "retry-after": String(result.retryAfter) } }
      );
    }
  }
  return null;
}

export function boardGameGuestError(error: unknown) {
  if (error instanceof BoardGameGuestError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  throw error;
}
