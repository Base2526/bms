// Local-only container test. Creates an isolated network, fake HTTP server and disposable Redis.
// Usage: docker build --target scheduler -t bms-scheduler:review -f apps/web/Dockerfile .
//        node scripts/testing/scheduler-smoke.mjs
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";

const image = "bms-scheduler:review";
const prefix = `bms-scheduler-smoke-${process.pid}-${Date.now()}`;
const containers = [];
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label) {
  for (let attempt = 0; attempt < 45; attempt++) {
    try { if (check()) return; } catch { /* wait for startup */ }
    await sleep(1_000);
  }
  throw new Error(`Timed out: ${label}`);
}
function run(name, ...args) {
  const full = `${prefix}-${name}`;
  containers.push(full);
  docker("run", "-d", "--name", full, "--network", prefix, ...args);
  return full;
}
const fakeServer = `
const http = require('node:http');
const counts = {};
http.createServer((req,res) => {
  if(req.url === '/admin/login') { res.end(); return; }
  res.setHeader('content-type','application/json');
  if(req.url === '/counts') { res.end(JSON.stringify(counts)); return; }
  if(req.headers['x-cron-secret'] === 'FAKE-error-only') {
    res.setHeader('x-bms-job-run-id','123');
    res.setHeader('x-bms-error-code','42703');
    res.writeHead(500); res.end(JSON.stringify({error:'FAKE-private-error-body'})); return;
  }
  if(req.method !== 'POST' || req.headers['x-cron-secret'] !== 'FAKE-smoke-only') {
    res.writeHead(401); res.end(JSON.stringify({ok:false})); return;
  }
  counts[req.url] = (counts[req.url] || 0) + 1;
  const nextTenant = req.url === '/api/bms/ai/evidence/purge-expired'
    ? '00000000-0000-4000-8000-000000000001' : null;
  res.end(JSON.stringify({ok:true,nextTenant}));
}).listen(3000,'0.0.0.0');`;

let networkCreated = false;
try {
  const missingName = `${prefix}-missing`;
  containers.push(missingName);
  const missing = spawnSync("docker", ["run", "--rm", "--name", missingName, image], { encoding: "utf8", timeout: 60_000 });
  if (missing.error) throw missing.error;
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /BMS_CRON_SECRET is required/);
  console.log("PASS missing secret refuses startup");
  docker("network", "create", prefix); networkCreated = true;
  const redis = run("redis", "--network-alias", "redis", "redis:7-alpine", "redis-server", "--save", "", "--appendonly", "no");
  const web = run("web", "--network-alias", "web", image, "node", "-e", fakeServer);
  await until(() => docker("exec", redis, "redis-cli", "ping") === "PONG", "Redis ready");
  const args = ["--read-only", "--tmpfs", "/tmp", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "-e", "BMS_CRON_SECRET=FAKE-smoke-only", "-e", "REDIS_URL=redis://redis:6379", image];
  const first = run("first", ...args);
  const second = run("second", ...args);
  const counts = () => JSON.parse(docker("exec", web, "node", "-e",
    "fetch('http://localhost:3000/counts').then(r=>r.text()).then(console.log)"));
  await until(() => Object.keys(counts()).length === 18, "17 jobs plus retention cursor page");
  for (const value of Object.values(counts())) assert.equal(value, 1);
  await until(() => { docker("exec", first, "node", "scheduler.mjs", "--healthcheck"); docker("exec", second, "node", "scheduler.mjs", "--healthcheck"); return true; }, "both schedulers healthy");
  console.log("PASS real Redis claims across two containers and paginated retention");
  docker("restart", first);
  await sleep(12_000);
  for (const value of Object.values(counts())) assert.equal(value, 1);
  console.log("PASS restart does not repeat the current UTC slots");
  const failing = run("failure", "--read-only", "--tmpfs", "/tmp",
    "-e", "BMS_CRON_SECRET=FAKE-error-only", "-e", "REDIS_URL=redis://redis:6379/1", image);
  await until(() => docker("logs", failing).includes('"serverCode":"42703"'), "HTTP error diagnostic");
  const failureEvents = docker("logs", failing).split("\n").map((line) => JSON.parse(line));
  const failure = failureEvents.find((entry) => entry.serverCode === "42703");
  assert.equal(failure.jobRunId, "123"); assert.equal(failure.stage, "http-response");
  assert.match(failure.runId, /^[0-9a-f-]{36}$/); assert.match(failure.requestId, /^[0-9a-f-]{36}$/);
  assert.ok(!JSON.stringify(failureEvents).includes("FAKE-private-error-body"));
  assert.ok(!JSON.stringify(failureEvents).includes("FAKE-error-only"));
  docker("stop", "--time", "20", failing);
  console.log("PASS HTTP errors retain correlation and SQLSTATE without private response data");
  docker("stop", redis);
  await sleep(16_000);
  const health = spawnSync("docker", ["exec", first, "node", "scheduler.mjs", "--healthcheck"], { timeout: 15_000 });
  assert.equal(health.status, 1);
  for (const value of Object.values(counts())) assert.equal(value, 1);
  console.log("PASS Redis loss makes health fail without new requests");
  for (const container of [first, second]) {
    docker("stop", "--time", "20", container);
    assert.equal(docker("inspect", "--format", "{{.State.ExitCode}}", container), "0");
    assert.ok(!docker("logs", container).includes("FAKE-smoke-only"));
  }
  console.log("PASS clean SIGTERM and credential-free scheduler logs");
} finally {
  for (const container of containers.reverse()) {
    try { docker("rm", "-f", container); } catch { /* best-effort teardown of this test only */ }
  }
  if (networkCreated) docker("network", "rm", prefix);
}
