import { createHash } from "node:crypto";
import { distributedRateLimit, type RateResult } from "./rateLimit";

type Limiter = (key: string, limit: number, windowMs: number) => Promise<RateResult | null>;

/** Neither forwarded headers nor a process-local counter authorize public admission. */
export async function checkRestaurantKioskRateLimit(
  token: string, action: string, ceiling: number, limiter: Limiter = distributedRateLimit
): Promise<{ status: 200 | 429 | 503; retryAfter: number }> {
  const digest = createHash("sha256").update(token).digest("hex");
  for (const [key, limit] of [
    [`restaurant-kiosk:${action}:fleet`, 1200],
    [`restaurant-kiosk:${action}:token:${digest}`, ceiling],
  ] as const) {
    let result: RateResult | null;
    try { result = await limiter(key, limit, 60_000); }
    catch { result = null; }
    if (!result) return { status: 503, retryAfter: 1 };
    if (!result.ok) return { status: 429, retryAfter: result.retryAfter };
  }
  return { status: 200, retryAfter: 0 };
}
