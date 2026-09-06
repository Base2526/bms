import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/bms/rateLimit";
import { RESTAURANT_QR_SESSION_COOKIE } from "@/lib/bms/restaurantQrOrdering";
import { RestaurantCheckError } from "@/lib/bms/restaurantPosErrors";

export function restaurantQrSessionToken(req: NextRequest) {
  return req.cookies.get(RESTAURANT_QR_SESSION_COOKIE)?.value ?? null;
}

export function restaurantQrPublicToken(req: NextRequest) {
  return req.headers.get("x-bms-restaurant-qr") ?? "";
}

export async function requireRestaurantQrRateLimit(
  req: NextRequest,
  scope: string,
  limit: number
) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const sessionToken = restaurantQrSessionToken(req);
  // Guests on restaurant Wi-Fi often share one public IP. Once a validly-shaped HttpOnly token is
  // present, isolate the normal menu/status/submit budget by a digest of that session rather than
  // making every occupied table consume one NAT-wide bucket. Opening a QR stays IP-scoped so an
  // attacker cannot mint unlimited fresh buckets simply by discarding cookies.
  const identity = scope !== "open" && sessionToken && /^[A-Za-z0-9_-]{32,128}$/.test(sessionToken)
    ? `session:${createHash("sha256").update(sessionToken).digest("hex")}`
    : `ip:${ip}`;
  const result = await rateLimit(`restaurant-qr:${scope}:${identity}`, limit, 60_000);
  return result.ok ? null : NextResponse.json(
    { error: "มีคำขอเข้ามาเร็วเกินไป กรุณารอสักครู่แล้วลองใหม่" },
    { status: 429, headers: { "retry-after": String(result.retryAfter) } }
  );
}

export function restaurantQrError(error: unknown) {
  if (error instanceof RestaurantCheckError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  throw error;
}
