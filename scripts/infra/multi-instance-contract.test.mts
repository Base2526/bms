// =============================================================
// Multi-instance readiness contract test
// -------------------------------------------------------------
// Covers the two pieces of per-instance state that had to become shared before
// this app can run as more than one web container:
//
//   1. lib/bms/rateLimit.ts  — counters in Redis, not a per-process Map
//   2. lib/storageDrivers/*  — file bytes reachable from any instance
//
// Run from apps/web (that package has tsx). --test-force-exit is required:
// ioredis keeps a handle open, so the runner would otherwise hang after the
// last assertion passes.
//   npx tsx --test --test-force-exit ../../scripts/infra/multi-instance-contract.test.mts
//
// Local-storage and pure-logic cases always run. The Redis and S3 cases SKIP
// (they do not silently pass) when REDIS_URL / S3_* are not reachable, so the
// suite is safe on a laptop with nothing running. To exercise them:
//
//   docker run -d -p 6379:6379 redis:7-alpine
//   docker run -d -p 9000:9000 -e MINIO_ROOT_USER=minioadmin \
//     -e MINIO_ROOT_PASSWORD=minioadmin quay.io/minio/minio server /data
//   REDIS_URL=redis://127.0.0.1:6379 \
//   S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=bms-test \
//   S3_ACCESS_KEY_ID=minioadmin S3_SECRET_ACCESS_KEY=minioadmin \
//   npx tsx --test --test-force-exit ../../scripts/infra/multi-instance-contract.test.mts
//
// (the bucket must exist first — MinIO does not create it on first PUT)
// =============================================================

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { Readable } from "node:stream";

const scratch = await mkdtemp(path.join(tmpdir(), "bms-storage-"));
process.env.STORAGE_DIR = scratch;

const { createLocalDriver } = await import("../../apps/web/lib/storageDrivers/local.ts");
const { toStorageKey } = await import("../../apps/web/lib/storageDrivers/index.ts");
const { rateLimit } = await import("../../apps/web/lib/bms/rateLimit.ts");

process.on("exit", () => {
  rm(scratch, { recursive: true, force: true }).catch(() => {});
});

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/**
 * Speak RESP over a raw socket rather than importing ioredis: this file lives
 * outside apps/web, so node_modules there is not on its resolution path.
 */
function redisCommand(url: string, args: string[]): Promise<string> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({
      host: u.hostname || "127.0.0.1",
      port: Number(u.port || 6379),
    });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("redis timeout"));
    }, 2000);
    let buf = "";
    sock.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    sock.on("connect", () => {
      sock.write(
        `*${args.length}\r\n` +
          args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join("")
      );
    });
    sock.on("data", (chunk) => {
      buf += chunk.toString();
      if (!buf.endsWith("\r\n")) return;
      clearTimeout(timer);
      sock.end();
      resolve(buf.trim());
    });
  });
}

async function redisReachable(): Promise<boolean> {
  const url = process.env.REDIS_URL;
  if (!url) return false;
  try {
    return (await redisCommand(url, ["PING"])) === "+PONG";
  } catch {
    return false;
  }
}

const REDIS_OK = await redisReachable();
const S3_CONFIGURED = Boolean(
  process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
);

// -------------------------------------------------------------
// Storage key normalisation
// -------------------------------------------------------------

test("storage keys are POSIX and driver-independent", () => {
  assert.equal(toStorageKey("2026\\08\\11\\1-a.png"), "2026/08/11/1-a.png");
  assert.equal(toStorageKey("/2026/08/11/1-a.png"), "2026/08/11/1-a.png");
  assert.equal(toStorageKey("2026/08/11/1-a.png"), "2026/08/11/1-a.png");
});

// -------------------------------------------------------------
// Local driver — must keep behaving exactly as the old inline fs code did
// -------------------------------------------------------------

test("local driver round-trips a buffer and reports its size", async () => {
  const driver = createLocalDriver();
  const key = "2026/08/11/1-local.bin";
  const body = crypto.randomBytes(2048);

  await driver.write(key, body);

  assert.deepEqual(await driver.stat(key), { size: body.length });
  assert.ok((await driver.read(key)).equals(body));
  assert.ok((await collect(await driver.openStream(key))).equals(body));
});

test("local driver serves a byte range (what /api/files/[id] needs)", async () => {
  const driver = createLocalDriver();
  const key = "2026/08/11/2-range.bin";
  const body = Buffer.from("0123456789abcdef");
  await driver.write(key, body);

  const part = await collect(await driver.openStream(key, { start: 4, end: 9 }));
  assert.equal(part.toString(), "456789");
});

test("local driver hashes and sizes a stream write", async () => {
  const driver = createLocalDriver();
  const key = "2026/08/11/3-stream.bin";
  const body = crypto.randomBytes(5000);

  const res = await driver.writeStream(key, Readable.from([body.subarray(0, 1000), body.subarray(1000)]));

  assert.equal(res.size, body.length);
  assert.equal(res.checksum, crypto.createHash("sha256").update(body).digest("hex"));
  assert.ok((await driver.read(key)).equals(body));
});

test("local driver reports a missing object as null, not a throw", async () => {
  const driver = createLocalDriver();
  assert.equal(await driver.stat("2026/08/11/does-not-exist.bin"), null);
});

test("local driver refuses a key that escapes STORAGE_DIR", async () => {
  const driver = createLocalDriver();
  await assert.rejects(
    () => driver.read("../../../etc/passwd"),
    /escapes STORAGE_DIR/
  );
});

// -------------------------------------------------------------
// Rate limit — the counter must be shared, and must degrade rather than open
// -------------------------------------------------------------

test(
  "rate limit blocks at the configured limit using a shared Redis counter",
  { skip: REDIS_OK ? false : "REDIS_URL not reachable" },
  async () => {
    const key = `contract-test:${crypto.randomUUID()}`;

    const first = await rateLimit(key, 3, 60_000);
    assert.equal(first.ok, true);
    assert.equal(first.remaining, 2);

    assert.equal((await rateLimit(key, 3, 60_000)).remaining, 1);
    assert.equal((await rateLimit(key, 3, 60_000)).remaining, 0);

    const blocked = await rateLimit(key, 3, 60_000);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.remaining, 0);
    assert.ok(blocked.retryAfter > 0 && blocked.retryAfter <= 60);
  }
);

test(
  "rate limit window does not slide — later hits must not extend the TTL",
  { skip: REDIS_OK ? false : "REDIS_URL not reachable" },
  async () => {
    const key = `contract-test:${crypto.randomUUID()}`;
    const url = process.env.REDIS_URL!;
    const pttl = async () =>
      Number((await redisCommand(url, ["PTTL", `ratelimit:${key}`])).replace(":", ""));

    await rateLimit(key, 5, 60_000);
    const ttlAfterFirst = await pttl();
    await new Promise((r) => setTimeout(r, 150));
    await rateLimit(key, 5, 60_000);
    const ttlAfterSecond = await pttl();

    assert.ok(ttlAfterFirst > 0, "first hit must set a TTL");
    assert.ok(
      ttlAfterSecond < ttlAfterFirst,
      `TTL should keep counting down (was ${ttlAfterFirst}, now ${ttlAfterSecond})`
    );
  }
);

test(
  "rate limit falls back to a per-instance window when Redis is unreachable",
  async () => {
    // Point a fresh module instance at a dead Redis so the fallback path runs.
    const previous = process.env.REDIS_URL;
    process.env.REDIS_URL = "redis://127.0.0.1:1";
    try {
      const mod = await import(`../../apps/web/lib/bms/rateLimit.ts?fallback=${crypto.randomUUID()}`);
      const key = `fallback:${crypto.randomUUID()}`;
      assert.equal((await mod.rateLimit(key, 2, 60_000)).ok, true);
      assert.equal((await mod.rateLimit(key, 2, 60_000)).ok, true);
      // Third call must be refused: falling back is not the same as failing open.
      assert.equal((await mod.rateLimit(key, 2, 60_000)).ok, false);
    } finally {
      if (previous === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = previous;
    }
  }
);

// -------------------------------------------------------------
// S3 driver — the part that actually unblocks running >1 instance
// -------------------------------------------------------------

test(
  "s3 driver round-trips, stats and range-reads an object",
  { skip: S3_CONFIGURED ? false : "S3_* env not set" },
  async () => {
    const { createS3Driver } = await import("../../apps/web/lib/storageDrivers/s3.ts");
    const driver = createS3Driver();
    const key = `2026/08/11/${crypto.randomUUID()}-s3.bin`;
    const body = Buffer.from("0123456789abcdef");

    await driver.write(key, body);

    assert.deepEqual(await driver.stat(key), { size: body.length });
    assert.ok((await driver.read(key)).equals(body));

    const part = await collect(await driver.openStream(key, { start: 4, end: 9 }));
    assert.equal(part.toString(), "456789");

    assert.equal(await driver.stat(`2026/08/11/${crypto.randomUUID()}-missing.bin`), null);
  }
);

test(
  "s3 driver stream write reports the same size and sha256 as the local driver",
  { skip: S3_CONFIGURED ? false : "S3_* env not set" },
  async () => {
    const { createS3Driver } = await import("../../apps/web/lib/storageDrivers/s3.ts");
    const driver = createS3Driver();
    const key = `2026/08/11/${crypto.randomUUID()}-s3-stream.bin`;
    const body = crypto.randomBytes(5000);

    const res = await driver.writeStream(
      key,
      Readable.from([body.subarray(0, 1000), body.subarray(1000)])
    );

    assert.equal(res.size, body.length);
    assert.equal(res.checksum, crypto.createHash("sha256").update(body).digest("hex"));
    assert.ok((await driver.read(key)).equals(body));
  }
);
