import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { sanitizeLogText } from "../apps/web/lib/log/sanitize.ts";
import { safePosAttemptId } from "../packages/pos-client-core/src/connectionFailure.ts";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");

test("wrapped REST routes record status and elapsed time without changing responses", async () => {
  const source = readFileSync(path.join(root, "apps/web/lib/log/routeError.ts"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} as Record<string, any> };
  const metrics: Array<{ name: string; durationMs: number; ok: boolean; errorCode: string | null }> = [];
  let metricThrows = false;
  const mocks: Record<string, unknown> = {
    "server-only": {},
    crypto: require("node:crypto"),
    "next/server": { NextResponse: { json: (body: unknown, init: ResponseInit) => Response.json(body, init) } },
    "@/lib/auth/server": { verifyAdminSession: () => null },
    "@/lib/bms/adminRouteAuth": { authorizeAdminRoute: async () => ({ ok: false }) },
    "./writeLog.server": { writeLogServer: () => {} },
    "./logThrottle": { ERROR_WINDOW_MS: 1000, shouldLog: () => false },
    "./sanitize": { sanitizeLogText },
    "@pos-core/connectionFailure": { safePosAttemptId },
    "@/lib/bms/restaurantPosErrors": { isRestaurantCheckError: () => false },
    "@/lib/bms/scheduledJobTrace": { withScheduledJobTrace: (_req: unknown, run: () => Promise<Response>) => run() },
    "@/lib/bms/requestMetrics": { recordRequestMetric: (value: typeof metrics[number]) => {
      if (metricThrows) throw new Error("Redis unavailable");
      metrics.push(value);
    } },
  };
  new Function("require", "module", "exports", js)((name: string) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, module, module.exports);
  const wrap = module.exports.withRouteErrorLog as (name: string, handler: () => Response | Promise<Response>) => () => Promise<Response>;

  const success = wrap("GET /api/bms/example", () => Response.json({ ok: true }));
  assert.deepEqual(await (await success()).json(), { ok: true });
  assert.equal(metrics[0].name, "rest:GET:/api/bms/example");
  assert.equal(metrics[0].ok, true);
  assert.equal(metrics[0].errorCode, null);
  assert.ok(metrics[0].durationMs >= 0);

  const denied = wrap("POST /api/bms/example", () => Response.json({ error: "Denied" }, { status: 403 }));
  assert.equal((await denied()).status, 403);
  assert.equal(metrics[1].ok, false);
  assert.equal(metrics[1].errorCode, "HTTP_403");

  const originalError = console.error;
  console.error = () => {};
  try {
    const crashed = wrap("GET /api/bms/example", () => { throw new Error("synthetic fault"); });
    assert.equal((await crashed()).status, 500);
    assert.equal(metrics[2].errorCode, "HTTP_500");
  } finally {
    console.error = originalError;
  }

  const graphql = wrap("/api/graphql", () => Response.json({ data: {} }));
  assert.equal((await graphql()).status, 200);
  assert.equal(metrics.length, 3, "Apollo metrics own the GraphQL request");

  const attempt = "53d0faad-81a4-473c-99c0-28c775abcf27";
  const posSession = wrap("GET /api/pos/session", () => Response.json({ ok: true }));
  const received = await (posSession as any)({ headers: new Headers({ "x-pos-attempt-id": attempt }) });
  assert.equal(received.headers.get("x-pos-attempt-id"), attempt);
  const rejected = await (posSession as any)({ headers: new Headers({ "x-pos-attempt-id": "customer-0891234567" }) });
  assert.equal(rejected.headers.get("x-pos-attempt-id"), null);
  const frozen = Response.json({ completed: true });
  Object.defineProperty(frozen, "headers", { value: { set() { throw new Error("immutable headers"); } } });
  const frozenResponse = wrap("POST /api/pos/sale", () => frozen);
  assert.equal(await (frozenResponse as any)({ headers: new Headers({ "x-pos-attempt-id": attempt }) }), frozen,
    "diagnostic response headers must not change a completed POS mutation");

  metricThrows = true;
  assert.equal((await denied()).status, 403, "metric failure must not change business responses");
  const long = wrap(`POST /api/bms/${"segment/".repeat(12)}safe`, () => new Response(null, { status: 204 }));
  metricThrows = false;
  await long();
  assert.ok(metrics.at(-1)!.name.length <= 60);
});
