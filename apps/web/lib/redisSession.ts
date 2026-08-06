// =============================================================
// lib/redisSession.ts — Redis-backed admin session registry
// -------------------------------------------------------------
// The JWT itself is still stateless and still carries `exp` — this module
// does NOT replace it. It only adds one thing the JWT alone structurally
// cannot do: **revoke a session before its `exp`** (logout, or a future
// "sign out everywhere"/force-logout-on-password-change action).
//
// Design: every admin JWT gets a random `jti`. On login we write
// `session:admin:<jti> = userId` with the same TTL as the cookie/JWT. On
// logout we delete that key. `isAdminSessionActive()` is the enforcement
// check — called once per request in app/api/graphql/route.ts's
// createContext(), which is the choke point nearly every admin action goes
// through (GraphQL is where BMS business logic lives, per CLAUDE.md).
//
// Fail-open on purpose: if Redis is unreachable, we trust the JWT alone
// (same behavior as before this feature existed) rather than locking every
// admin out because of an infra blip. This mirrors the existing
// fail-open convention in lib/cache.ts and lib/bms/failureAlert.ts.
//
// Known gap: server-rendered admin pages that call verifyAdminSession()
// directly (layout.tsx gates) still trust the JWT alone — only requests
// through the GraphQL API re-check Redis. In this app that covers every
// mutation and almost every read, since page shells fetch their real data
// over GraphQL immediately after render.
// =============================================================

import Redis from "ioredis";

const url = process.env.REDIS_URL || "redis://redis:6379";

const client = new Redis(url, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

client.on("error", (err) => {
  console.error("[redisSession] redis error (ignored, trusting JWT alone)", err?.message ?? err);
});

const sessionKey = (jti: string) => `session:admin:${jti}`;

export async function createAdminSession(jti: string, userId: string | number, ttlSeconds: number): Promise<void> {
  try {
    await client.set(sessionKey(jti), String(userId), "EX", ttlSeconds);
  } catch (err: any) {
    console.error("[redisSession] create failed (login still succeeds, revocation just won't apply)", err?.message ?? err);
  }
}

/**
 * Fail-open: Redis error or no `jti` on the token (tokens minted before this
 * feature shipped) → treat as active, i.e. trust the JWT's own `exp`.
 */
export async function isAdminSessionActive(jti: string | undefined | null): Promise<boolean> {
  if (!jti) return true;
  try {
    const exists = await client.exists(sessionKey(jti));
    return exists === 1;
  } catch (err: any) {
    console.error("[redisSession] check failed (ignored, trusting JWT)", err?.message ?? err);
    return true;
  }
}

export async function revokeAdminSession(jti: string | undefined | null): Promise<void> {
  if (!jti) return;
  try {
    await client.del(sessionKey(jti));
  } catch (err: any) {
    console.error("[redisSession] revoke failed (ignored)", err?.message ?? err);
  }
}
