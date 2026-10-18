import assert from "node:assert/strict";
import test from "node:test";
import { createFleetDeliveryServer } from "./server.js";

test("health endpoints separate liveness from dependency readiness", async () => {
  const pool = { query: async () => ({ rows: [], rowCount: 1 }) };
  const redis = { ping: async () => "PONG" };
  const server = createFleetDeliveryServer({
    pool: pool as never,
    redis: redis as never,
    maxBodyBytes: 1_024,
    serviceRateLimitPerMinute: 10,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const live = await fetch(`${base}/livez`);
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { ok: true });
    assert.equal(live.headers.get("cache-control"), "no-store");
    assert.equal(live.headers.get("content-security-policy"), "default-src 'none'; frame-ancestors 'none'");
    assert.equal(live.headers.get("permissions-policy"), "camera=(), geolocation=(), microphone=()");
    assert.equal(live.headers.get("referrer-policy"), "no-referrer");
    assert.equal(live.headers.get("x-content-type-options"), "nosniff");
    assert.equal(live.headers.get("x-frame-options"), "DENY");
    const ready = await fetch(`${base}/readyz`);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json() as { ok: boolean }).ok, true);
    assert.equal(server.requestTimeout, 15_000);
    assert.equal(server.headersTimeout, 10_000);
    assert.equal(server.keepAliveTimeout, 5_000);
    assert.equal(server.maxHeadersCount, 64);
    assert.equal(server.maxRequestsPerSocket, 1_000);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("readiness fails closed for dependency loss and graceful drain", async () => {
  let draining = false;
  const pool = { query: async () => { throw new Error("database unavailable"); } };
  const redis = { ping: async () => "PONG" };
  const server = createFleetDeliveryServer({
    pool: pool as never,
    redis: redis as never,
    isDraining: () => draining,
    maxBodyBytes: 1_024,
    serviceRateLimitPerMinute: 10,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const dependencyFailure = await fetch(`${base}/readyz`);
    assert.equal(dependencyFailure.status, 503);
    assert.deepEqual(await dependencyFailure.json(), {
      ok: false,
      components: { database: "error", redis: "ok" },
    });
    draining = true;
    const drain = await fetch(`${base}/readyz`);
    assert.equal(drain.status, 503);
    assert.deepEqual(await drain.json(), {
      ok: false,
      draining: true,
      components: { database: "skipped", redis: "skipped" },
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
