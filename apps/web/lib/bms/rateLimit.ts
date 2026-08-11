// =============================================================
// BMS fixed-window rate limit (webhooks + auth, in-memory)
// -------------------------------------------------------------
// จำกัดจำนวน request ต่อ key (เช่น tenant+channel หรือ hashed login identity) ต่อหน้าต่างเวลา
// หมายเหตุ: in-memory = ต่อ instance — ถ้ารันหลาย instance ควรย้ายไป Redis (INCR+EXPIRE)
// =============================================================

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
let callsSinceCleanup = 0;

export type RateResult = { ok: boolean; remaining: number; retryAfter: number };

/** ตรวจ rate limit; คืน ok=false ถ้าเกินโควตาในหน้าต่างนี้ */
export function rateLimit(key: string, limit = 60, windowMs = 60_000): RateResult {
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
