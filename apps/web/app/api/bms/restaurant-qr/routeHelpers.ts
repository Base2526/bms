import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/bms/rateLimit";
import { RESTAURANT_QR_SESSION_COOKIE } from "@/lib/bms/restaurantQrOrdering";
import { RestaurantCheckError } from "@/lib/bms/restaurantPosErrors";
import { planRestaurantQrRateLimitBuckets } from "@/lib/bms/restaurantQrRateLimit";

export function restaurantQrSessionToken(req: NextRequest) {
  return req.cookies.get(RESTAURANT_QR_SESSION_COOKIE)?.value ?? null;
}

export function restaurantQrPublicToken(req: NextRequest) {
  return req.headers.get("x-bms-restaurant-qr") ?? "";
}

/**
 * บังคับเพดานทุกชั้นที่ `planRestaurantQrRateLimitBuckets()` วางไว้ — ต้องผ่านครบทุกใบ
 *
 * ตัวตัดสินว่ามีกี่ชั้นและชั้นละเท่าไรเป็น pure อยู่ใน `lib/bms/restaurantQrRateLimit.ts`
 * (เทสได้ตรง ๆ) · ที่นี่เหลือแค่การอ่าน IP/คุกกี้จากคำขอแล้วเดินตามแผน
 */
export async function requireRestaurantQrRateLimit(
  req: NextRequest,
  scope: string,
  limit: number
) {
  const buckets = planRestaurantQrRateLimitBuckets({
    scope,
    limit,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown",
    sessionToken: restaurantQrSessionToken(req),
    sessionDigest: (token) => createHash("sha256").update(token).digest("hex"),
  });
  for (const bucket of buckets) {
    const result = await rateLimit(bucket.key, bucket.limit, 60_000);
    if (!result.ok) {
      return NextResponse.json(
        { error: "มีคำขอเข้ามาเร็วเกินไป กรุณารอสักครู่แล้วลองใหม่" },
        { status: 429, headers: { "retry-after": String(result.retryAfter) } }
      );
    }
  }
  return null;
}

export function restaurantQrError(error: unknown) {
  if (error instanceof RestaurantCheckError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  throw error;
}
