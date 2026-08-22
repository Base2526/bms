// =============================================================
// lib/cache.ts — generic Redis read-cache (separate from pubsub/session Redis usage)
// -------------------------------------------------------------
// Fail-open by design: this app has never depended on Redis for correctness
// before now, and a cache must not become a new outage vector. Any Redis
// error here is logged and treated as a cache miss — callers always fall
// back to the real query. Keys are namespaced "cache:" so they're visible
// and safe to FLUSH/SCAN separately from pubsub/session keys.
// =============================================================

import Redis from "ioredis";

const url = process.env.REDIS_URL || "redis://redis:6379";

const client = new Redis(url, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

client.on("error", (err) => {
  console.error("[cache] redis error (ignored, falling back to source)", err?.message ?? err);
});

// Shared connection reuse — this app already opens 3 ioredis clients
// (cache/rateLimit/session); health checks and request metrics reuse this one
// rather than adding more. Other modules MUST namespace their own keys
// (e.g. "metrics:") and never touch the "cache:" prefix owned by this file.
export { client as sharedRedisClient };

const keyFor = (key: string) => `cache:${key}`;

/**
 * Read-through cache: return the cached value if present, otherwise call
 * `loader()`, cache its result for `ttlSeconds`, and return it. Never throws —
 * a Redis outage just means every call behaves like there's no cache.
 */
export async function getOrSetCache<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>
): Promise<T> {
  try {
    const raw = await client.get(keyFor(key));
    if (raw !== null) return JSON.parse(raw) as T;
  } catch (err: any) {
    console.error("[cache] get failed (ignored)", key, err?.message ?? err);
  }

  const value = await loader();

  try {
    await client.set(keyFor(key), JSON.stringify(value), "EX", ttlSeconds);
  } catch (err: any) {
    console.error("[cache] set failed (ignored)", key, err?.message ?? err);
  }

  return value;
}

/** Invalidate one exact key. Call this right after any write that changes what a cached read would return. */
export async function invalidateCache(key: string): Promise<void> {
  try {
    await client.del(keyFor(key));
  } catch (err: any) {
    console.error("[cache] invalidate failed (ignored)", key, err?.message ?? err);
  }
}

/** Invalidate every key matching `prefix*` — use sparingly (SCAN, not KEYS, so it won't block Redis on a big keyspace). */
export async function invalidateCachePrefix(prefix: string): Promise<void> {
  try {
    const pattern = `${keyFor(prefix)}*`;
    let cursor = "0";
    do {
      const [next, keys] = await client.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = next;
      if (keys.length) await client.del(...keys);
    } while (cursor !== "0");
  } catch (err: any) {
    console.error("[cache] invalidate prefix failed (ignored)", prefix, err?.message ?? err);
  }
}
