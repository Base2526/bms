import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { readBoundedBodyBytes } from "../apps/web/lib/bms/webhookBody.ts";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript") as typeof import("typescript");

test("AI Playground API enforces its UI permission before AI or conversation writes", async () => {
  const source = readFileSync(path.join(root, "apps/web/app/api/bms/chat/route.ts"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} as Record<string, any> };
  const calls: unknown[][] = [];
  let auth: Record<string, unknown> = { ok: false, status: 401 };
  const mocks: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, options?: { status?: number }) =>
      ({ body, status: options?.status ?? 200 }) } },
    "@/lib/bms/pipeline": { runPipeline: async (...args: unknown[]) => {
      calls.push(["AI", ...args]);
      return { reply: "verified fixture", trace: [] };
    } },
    "@/lib/bms/inbox": { logConversation: async (...args: unknown[]) => {
      calls.push(["conversation", ...args]);
      return null;
    } },
    "@/lib/bms/adminRouteAuth": { authorizeAdminRoute: async (permission: string) => {
      assert.equal(permission, "ai_quality.view");
      return auth;
    } },
    "@/lib/bms/webhookBody": { readBoundedBodyBytes },
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
  };
  new Function("require", "module", "exports", js)((name: string) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, module, module.exports);
  const post = module.exports.POST as (request: Request) => Promise<any>;
  const request = (body: unknown) => new Request("https://bms.example.invalid/api/bms/chat", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });

  assert.equal((await post(request({ message: "hello" }))).status, 401);
  auth = { ok: false, status: 403 };
  assert.equal((await post(request({ message: "hello" }))).status, 403);
  assert.deepEqual(calls, []);

  auth = { ok: true, tenantId: "session-tenant", adminId: "admin-a" };
  assert.equal((await post(request({ message: "  ", channel: "web" }))).status, 400);
  assert.equal((await post(new Request("https://bms.example.invalid/api/bms/chat", {
    method: "POST", body: "{broken",
  }))).status, 400);
  assert.equal((await post(request({ message: "x".repeat(10_001) }))).status, 413);
  assert.equal((await post(request({ message: "hello", customerRef: "x".repeat(257) }))).status, 400);
  assert.equal((await post(request({ message: "x".repeat(65 * 1024) }))).status, 413);
  assert.equal((await post(request([]))).status, 400);
  assert.equal((await post(new Request("https://bms.example.invalid/api/bms/chat", {
    method: "POST", body: new Uint8Array([0xff]),
  }))).status, 400);
  assert.deepEqual(calls, []);
  const result = await post(request({ message: "hello", channel: "test", tenantId: "spoofed-tenant" }));
  assert.equal(result.status, 200);
  assert.deepEqual(calls, [
    ["AI", "hello", "test", "session-tenant", null],
    ["conversation", "session-tenant", "test", null, "hello", "verified fixture", undefined],
  ]);
});
