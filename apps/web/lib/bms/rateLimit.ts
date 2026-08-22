// =============================================================
// BMS fixed-window rate limit (webhooks + auth)
// -------------------------------------------------------------
// Counters live in Redis so the limit is enforced across the whole fleet.
// A per-process Map used to be the store, which meant the real limit was
// (configured limit x number of instances) — harmless for one container,
// but it silently weakens login brute-force protection in proportion to how
// far the app is scaled out.
//
// Fallback, deliberately NOT fail-open: if Redis is unreachable the in-memory
// window still runs. That degrades enforcement back to per-instance (exactly
// how this file behaved before Redis) instead of dropping the limit entirely,
// which is what a plain fail-open would do to `auth:*` keys.
// =============================================================

import Redis from "ioredis";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
let callsSinceCleanup = 0;

export type RateResult = { ok: boolean; remaining: number; retryAfter: number };

const url = process.env.REDIS_URL || "redis://redis:6379";

const client = new Redis(url, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

client.on("error", (err) => {
  console.error(
    "[rateLimit] redis error (falling back to per-instance window)",
    err?.message ?? err
  );
});

const keyFor = (key: string) => `ratelimit:${key}`;

/**
 * Fixed window in Redis: INCR the counter, and set the TTL only on the call
 * that created it (count === 1) so the window starts at the first hit and is
 * not extended by later ones. PTTL gives the caller an accurate Retry-After.
 */
async function redisRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateResult> {
  const redisKey = keyFor(key);
  const [[incrErr, countRaw], [pexpireErr]] = (await client
    .multi()
    .incr(redisKey)
    .pexpire(redisKey, windowMs, "NX")
    .exec()) as [[Error | null, number], [Error | null, unknown]];

  if (incrErr) throw incrErr;
  if (pexpireErr) throw pexpireErr;

  const count = Number(countRaw);

  if (count > limit) {
    const pttl = await client.pttl(redisKey);
    // -1 = key exists with no TTL, -2 = key already gone. Neither should
    // happen given the NX expire above, but never report a negative wait.
    const retryAfter = pttl > 0 ? Math.ceil(pttl / 1000) : Math.ceil(windowMs / 1000);
    return { ok: false, remaining: 0, retryAfter };
  }

  return { ok: true, remaining: limit - count, retryAfter: 0 };
}

/** Per-instance fixed window — the pre-Redis behaviour, kept as the fallback. */
function memoryRateLimit(key: string, limit: number, windowMs: number): RateResult {
  const nowMs = Date.now();
  callsSinceCleanup += 1;
  if (callsSinceCleanup >= 256 || buckets.size >= 10_000) {
    callsSinceCleanup = 0;
    for (const [bucketKey, bucket] of buckets) {
      if (nowMs >= bucket.resetAt) buckets.delete(bucketKey);
    }
    // Keep this fail-safe bounded even under distributed-key abuse on one instance.
    while (buckets.size >= 10_000) {
      const oldestKey = buckets.keys().next().value as string | undefined;
      if (!oldestKey) break;
      buckets.delete(oldestKey);
    }
  }
  const b = buckets.get(key);
  if (!b || nowMs >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: nowMs + windowMs });
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }
  if (b.count >= limit) {
    return { ok: false, remaining: 0, retryAfter: Math.ceil((b.resetAt - nowMs) / 1000) };
  }
  b.count += 1;
  return { ok: true, remaining: limit - b.count, retryAfter: 0 };
}

/** ตรวจ rate limit; คืน ok=false ถ้าเกินโควตาในหน้าต่างนี้ */
export async function rateLimit(
  key: string,
  limit = 60,
  windowMs = 60_000
): Promise<RateResult> {
  try {
    return await redisRateLimit(key, limit, windowMs);
  } catch (err: any) {
    console.error(
      "[rateLimit] redis check failed, using per-instance window",
      key,
      err?.message ?? err
    );
    return memoryRateLimit(key, limit, windowMs);
  }
}
