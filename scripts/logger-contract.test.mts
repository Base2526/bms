import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { sanitizeLogText, sanitizeLogValue } from "../apps/web/lib/log/sanitize.ts";
import { formatLogReport } from "./bms-log-triage/report-format.mjs";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

function loadTs(file: string, mocks: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const js = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} as Record<string, any> };
  new Function("require", "module", "exports", ...Object.keys(globals), js)((name: string) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, module, module.exports, ...Object.values(globals));
  return module.exports;
}

test("log sanitization bounds nested metadata and removes credentials and contact data", () => {
  const secret = "sk-" + "a".repeat(36);
  const text = sanitizeLogText(`Bearer abc.def ghi@example.com +66812345678 192.168.0.1 ${secret} pin=1234 1234567890123`);
  for (const value of ["abc.def", "ghi@example.com", "+66812345678", "192.168.0.1", secret, "1234", "1234567890123"]) {
    assert.equal(text.includes(value), false, value);
  }
  assert.equal(sanitizeLogText('{"password":"super-secret","pin": "1234"}').includes("super-secret"), false);
  const meta = sanitizeLogValue({ cashierPin: "1234", customerName: "Ada", nested: { email: "a@example.com", safe: "ready" }, sessionId: "opaque" }) as any;
  assert.equal(meta.cashierPin, "[REDACTED]");
  assert.equal(meta.customerName, "[REDACTED]");
  assert.equal(meta.nested.email, "[REDACTED]");
  assert.equal(meta.nested.safe, "ready");
  assert.equal(meta.sessionId, "[REDACTED]");
  assert.equal((sanitizeLogValue(JSON.parse('{"__proto__":{"polluted":true},"safe":true}')) as any).safe, true);
  assert.equal(({} as any).polluted, undefined);
  assert.ok((sanitizeLogValue({ stack: "x".repeat(20_000) }) as any).stack.length <= 12_000);
});

test("legacy JSON console and optional DB logger share the redaction boundary", async () => {
  const stdout: string[] = [];
  const params: unknown[][] = [];
  const logger = loadTs("apps/web/lib/logger.ts", {
    "@/lib/db": { query: async (_sql: string, values: unknown[]) => { params.push(values); return { rows: [] }; } },
    "@/lib/log/sanitize": { sanitizeLogText, sanitizeLogValue },
  });
  const oldLog = console.log;
  const oldDbLog = process.env.DB_LOG;
  console.log = (value: unknown) => { stdout.push(String(value)); };
  process.env.DB_LOG = "true";
  try {
    logger.log("error", "auth", "failed for a@example.com", { phone: "0812345678" });
    logger.log("info", "auth", "unsafe getter", { get value() { throw new Error("sensitive"); } });
    await logger.writeLogToDb({ level: "error", category: "auth", message: "Bearer abc.def", meta: { password: "secret" }, at: new Date().toISOString() });
  } finally {
    console.log = oldLog;
    if (oldDbLog === undefined) delete process.env.DB_LOG;
    else process.env.DB_LOG = oldDbLog;
  }
  assert.equal(stdout.join(" ").includes("a@example.com"), false);
  assert.equal(stdout.join(" ").includes("0812345678"), false);
  assert.equal(stdout.join(" ").includes("sensitive"), false);
  assert.equal(JSON.stringify(params).includes("abc.def"), false);
  assert.equal(JSON.stringify(params).includes("secret"), false);
});

test("server logger persists redacted data, never converts a UUID to created_by, and suppresses client alerts", async () => {
  const calls: Array<{ sql: string; params: any[] }> = [];
  const alerts: unknown[] = [];
  const { writeLogServer } = loadTs("apps/web/lib/log/writeLog.server.ts", {
    "server-only": {},
    "@/lib/db": { query: async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("information_schema.columns")) return { rows: [{ exists: true }] };
      return { rows: [], rowCount: 1 };
    } },
    "./alertSlackServer": { maybeAlertSlackForLog: async (signal: unknown) => { alerts.push(signal); } },
    "./sanitize": { sanitizeLogText, sanitizeLogValue },
  });
  const userId = "11111111-1111-4111-8111-111111111111";
  assert.equal(await writeLogServer("error", "graphql", "failed for a@example.com", {
    action: "graphql.error", userId, tenantId: userId,
    phone: "0812345678", errorMessage: "Bearer abc.def", sessionId: "secret-session",
  }, { alert: false }), true);
  const inserted = calls.find((call) => call.sql.includes("INSERT INTO system_logs"))!;
  assert.ok(inserted);
  assert.equal(inserted.params[4], null, "UUID must not become a misleading integer actor");
  assert.equal(JSON.stringify(inserted.params).includes("a@example.com"), false);
  assert.equal(JSON.stringify(inserted.params).includes("0812345678"), false);
  assert.equal(JSON.stringify(inserted.params).includes("abc.def"), false);
  assert.deepEqual(alerts, []);
});

test("Slack alerts claim atomically and release a failed webhook delivery", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let responseOk = false;
  const { maybeAlertSlackForLog } = loadTs("apps/web/lib/log/alertSlackServer.ts", {
    "server-only": {},
    crypto: require("node:crypto"),
    "./sanitize": { sanitizeLogValue },
    "@/lib/db": { query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes("COUNT(*)")) return { rows: [{ count: 3 }] };
      if (sql.includes("INSERT INTO slack_alert_dedupe")) return { rows: [{ last_sent_at: "2026-11-16T00:00:00Z" }] };
      return { rows: [], rowCount: 1 };
    } },
  }, { fetch: async () => ({ ok: responseOk, status: responseOk ? 200 : 500 }) });
  const oldWebhook = process.env.SLACK_WEBHOOK_URL;
  const oldConsoleError = console.error;
  process.env.SLACK_WEBHOOK_URL = "https://example.test/slack";
  console.error = () => {};
  try {
    const signal = { level: "error", category: "graphql", action: "graphql.error", error_message: "database unavailable", message: "request failed" };
    await maybeAlertSlackForLog(signal);
    assert.ok(calls.some((call) => call.sql.includes("ON CONFLICT") && call.sql.includes("RETURNING last_sent_at")));
    assert.ok(calls.some((call) => call.sql.includes("DELETE FROM slack_alert_dedupe")), "failed delivery releases its claim");
    const count = calls.find((call) => call.sql.includes("COUNT(*)"))!;
    assert.deepEqual(count.params.slice(0, 2), ["graphql", "database unavailable"]);
    responseOk = true;
    calls.length = 0;
    await maybeAlertSlackForLog(signal);
    assert.equal(calls.some((call) => call.sql.includes("DELETE FROM slack_alert_dedupe")), false);
  } finally {
    console.error = oldConsoleError;
    if (oldWebhook === undefined) delete process.env.SLACK_WEBHOOK_URL;
    else process.env.SLACK_WEBHOOK_URL = oldWebhook;
  }
});

test("client log API validates batches and binds actor, tenant and source on the server", async () => {
  const writes: Array<{ level: string; meta: Record<string, unknown>; options: unknown }> = [];
  const { POST } = loadTs("apps/web/app/api/logs/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/db": { query: async () => ({ rows: [] }), getClient: async () => { throw new Error("unused"); } },
    "@/lib/auth/server": { verifyUserFromRequest: () => null },
    "@/lib/bms/adminRouteAuth": {
      authorizeAdminRoute: async () => ({ ok: true, admin: { id: "actor-a" }, tenantId: "tenant-a" }),
      authorizePlatformAdminRoute: async () => ({ ok: true, adminId: "actor-a" }),
    },
    "@/lib/bms/rateLimit": { rateLimit: async () => ({ ok: true }) },
    "@/lib/log/writeLog.server": { writeLogServer: async (level: string, _category: string, _message: string, meta: Record<string, unknown>, options: unknown) => {
      writes.push({ level, meta, options });
      return true;
    } },
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
    "@/lib/bms/webhookBody": { readBoundedWebhookText: async (request: Request) => ({ ok: true, text: await request.text() }) },
  });
  const post = (body: string) => POST(new Request("http://localhost/api/logs", { method: "POST", body }));
  assert.equal((await post("not json")).status, 400);
  assert.equal((await post(JSON.stringify({ logs: [{ level: "info" }, { level: "fatal" }] }))).status, 400);
  assert.equal(writes.length, 0, "a malformed batch must not partially write");
  const response = await post(JSON.stringify({ level: "error", category: "graphql", message: "client failure", meta: {
    userId: "forged", tenantId: "forged", source: "server", action: "client.error",
  } }));
  assert.equal(response.status, 201);
  assert.equal(writes[0].meta.userId, "actor-a");
  assert.equal(writes[0].meta.tenantId, "tenant-a");
  assert.equal(writes[0].meta.source, "client");
  assert.deepEqual(writes[0].options, { alert: false });
});

test("log reads reject unsafe filters and search literal text with stable pagination", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const { GET } = loadTs("apps/web/app/api/logs/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/db": { query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("information_schema.columns")) return { rows: [{ exists: true }] };
      if (sql.includes("COUNT(*)")) return { rows: [{ count: 0 }] };
      return { rows: [] };
    }, getClient: async () => { throw new Error("unused"); } },
    "@/lib/auth/server": { verifyUserFromRequest: () => null },
    "@/lib/bms/adminRouteAuth": { authorizeAdminRoute: async () => ({ ok: false, status: 401 }), authorizePlatformAdminRoute: async () => ({ ok: true, adminId: "actor-a" }) },
    "@/lib/bms/rateLimit": { rateLimit: async () => ({ ok: true }) },
    "@/lib/log/writeLog.server": { writeLogServer: async () => true },
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
    "@/lib/bms/webhookBody": { readBoundedWebhookText: async () => ({ ok: true, text: "{}" }) },
  });
  const get = (query: string) => GET(new Request(`http://localhost/api/logs?${query}`));
  assert.equal((await get("page=0")).status, 400);
  assert.equal((await get("user_id=9999999999")).status, 400);
  assert.equal((await get("date_start=2026-02-30")).status, 400);
  const uuid = "11111111-1111-4111-8111-111111111111";
  assert.equal((await get(`q=%25&user_id=${uuid}&page=2`)).status, 200);
  const list = calls.find((call) => call.sql.includes("FROM system_logs") && call.sql.includes("LIMIT"))!;
  assert.match(list.sql, /POSITION\(LOWER\(\$1\) IN LOWER\(message\)\)/);
  assert.match(list.sql, /ORDER BY created_at DESC, id DESC/);
  assert.deepEqual(list.params.slice(0, 2), ["%", uuid]);
});

test("log detail accepts legacy UUID IDs and rejects partial or out-of-range IDs", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const { GET } = loadTs("apps/web/app/api/logs/[id]/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/db": { query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("information_schema.columns")) return { rows: [{ exists: true }] };
      return { rows: [{ id: params[0] }] };
    } },
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
    "@/lib/bms/adminRouteAuth": { authorizePlatformAdminRoute: async () => ({ ok: true }) },
  });
  const get = (id: string) => GET(new Request(`http://localhost/api/logs/${id}`), { params: { id } });
  assert.equal((await get("1abc")).status, 400);
  assert.equal((await get("9223372036854775808")).status, 400);
  const uuid = "11111111-1111-4111-8111-111111111111";
  assert.equal((await get(uuid)).status, 200);
  assert.match(calls.at(-1)!.sql, /WHERE id::text = \$1/);
  assert.deepEqual(calls.at(-1)!.params, [uuid]);
});

test("log deletion requires confirmation, validates IDs and audits the same transaction", async () => {
  const calls: string[] = [];
  const { DELETE } = loadTs("apps/web/app/api/logs/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/db": {
      query: async (sql: string) => ({ rows: [{ exists: true }], rowCount: sql.includes("SELECT") ? 1 : 0 }),
      getClient: async () => ({ query: async (sql: string) => {
        calls.push(sql);
        return { rowCount: sql.startsWith("DELETE") ? 2 : 1 };
      }, release: () => { calls.push("RELEASE"); } }),
    },
    "@/lib/auth/server": { verifyUserFromRequest: () => null },
    "@/lib/bms/adminRouteAuth": { authorizeAdminRoute: async () => ({ ok: false, status: 401 }), authorizePlatformAdminRoute: async () => ({ ok: true, adminId: "actor-a" }) },
    "@/lib/bms/rateLimit": { rateLimit: async () => ({ ok: true }) },
    "@/lib/log/writeLog.server": { writeLogServer: async () => true },
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
    "@/lib/bms/webhookBody": { readBoundedWebhookText: async () => ({ ok: true, text: "{}" }) },
  });
  const del = (ids: string, confirmed: boolean) => DELETE(new Request(`http://localhost/api/logs?ids=${ids}`, {
    method: "DELETE", headers: confirmed ? { "x-bms-confirmed": "true" } : {},
  }));
  assert.equal((await del("1,2", false)).status, 400);
  assert.equal((await del("1abc", true)).status, 400);
  assert.deepEqual(calls, []);
  const result = await del("1,2", true);
  assert.deepEqual(await result.json(), { deleted: 2 });
  assert.deepEqual(calls.map((sql) => sql.split(" ")[0]), ["BEGIN", "DELETE", "INSERT", "COMMIT", "RELEASE"]);
  assert.match(calls[1], /category <> 'log-admin'/);
  assert.match(calls[1], /id::text = ANY\(\$1::text\[\]\)/);
  const uuidResult = await del("11111111-1111-4111-8111-111111111111", true);
  assert.equal(uuidResult.status, 200, "legacy UUID log ids remain deletable");
});

test("GraphQL resolver logs no request values, even in debug mode", () => {
  const source = read("apps/web/graphql/resolvers.ts");
  const wrapper = source.slice(source.indexOf("function buildResolverMeta"), source.indexOf("function encodeMessageCursor"));
  assert.doesNotMatch(wrapper, /\bphone\b|bank_name|account_no|redactSecrets\(args\)/);
  assert.match(wrapper, /argumentKeys: argsRec \? Object\.keys\(argsRec\)/);
});

test("daily triage report redacts every exported field and labels client evidence", () => {
  const secret = "sk-" + "a".repeat(32);
  const report = formatLogReport([{
    source: "client", category: `mobile\n# steal ${secret}`,
    msg: 'email a@example.com pin=1234 {"password":"super-secret"}',
    cnt: 3, last_at: "2026-11-16T00:00:00Z",
    route: "/api/test?access_token=super-secret",
    sample_stack: "```\nBearer abc.def\n0812345678",
  }], { today: "2026-11-16", hours: 24 });
  for (const value of [secret, "a@example.com", "1234", "super-secret", "abc.def", "0812345678"]) {
    assert.equal(report.includes(value), false, value);
  }
  assert.match(report, /client \/ mobile/);
  assert.equal(report.includes("\n# steal"), false);
  assert.equal((report.match(/```/g) ?? []).length, 2, "log text cannot close the stack fence");
  const collector = read("scripts/bms-log-triage/collect-error-logs.mjs");
  assert.match(collector, /formatLogReport\(rows/);
  assert.match(collector, /GROUP BY category, source, msg/);
});
