import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";
import { timedFetch, toRequestResult } from "./load-test/measure.mts";

test("load measurement includes the body and checks parsed GraphQL outcome", async () => {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.flushHeaders();
    if (req.url === "/slow") {
      setTimeout(() => res.end('{"ok":true}'), 80);
    } else if (req.url === "/api/graphql?failure") {
      res.end('{"data":{"value":null},"errors":[{"message":"denied"}]}');
    } else if (req.url === "/api/graphql?invalid") {
      res.end('{"data":null}');
    } else if (req.url === "/api/graphql?bad-errors") {
      res.end('{"data":{"value":1},"errors":"unexpected"}');
    } else {
      res.end('{"data":{"value":"text mentioning errors is still data"}}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const slow = await timedFetch(`${base}/slow`, {}, 1000);
    assert.ok(slow.durationMs >= 50, `body wait missing from ${slow.durationMs}ms latency`);
    assert.equal(toRequestResult(slow).ok, true);

    assert.equal(toRequestResult(await timedFetch(`${base}/api/graphql`, {}, 1000)).ok, true);
    const failure = toRequestResult(await timedFetch(`${base}/api/graphql?failure`, {}, 1000));
    assert.equal(failure.status, 200);
    assert.equal(failure.ok, false);
    assert.match(failure.error ?? "", /GraphQL errors/);
    assert.equal(toRequestResult(await timedFetch(`${base}/api/graphql?invalid`, {}, 1000)).ok, false);
    assert.equal(toRequestResult(await timedFetch(`${base}/api/graphql?bad-errors`, {}, 1000)).ok, false);
    await assert.rejects(timedFetch(`${base}/slow`, {}, 20), /timeout|aborted/i);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("load runner reports a local read-only scenario without setup or hidden failures", async () => {
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const webDir = path.resolve(import.meta.dirname, "../apps/web");
  try {
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn("npx", ["--no-install", "tsx", "../../scripts/load-test/run.mts",
        "--scenario", "checkout-read", "--concurrency", "2", "--duration", "0.5", "--timeout", "1000"], {
        cwd: webDir,
        env: { ...process.env, BASE_URL: `http://127.0.0.1:${address.port}`, CHECKOUT_TOKEN: "FAKE-read-only" },
      });
      let output = "";
      child.stdout.on("data", chunk => { output += String(chunk); });
      child.stderr.on("data", chunk => { output += String(chunk); });
      child.on("error", reject);
      child.on("close", code => resolve({ code, output }));
    });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /setupSeconds=.*excluded from request throughput/);
    assert.match(result.output, /failed\s+0/);
    assert.match(result.output, /successRate\s+100\.00%/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
