import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { resolveWebChatSession } from "../apps/web/lib/bms/webChatSession.ts";
import { signCustomerToken } from "../apps/web/lib/bms/customerSecurityToken.ts";

test("web sessions are server-issued, tenant-scoped and stable across messages", () => {
  const first = resolveWebChatSession("tenant-a", undefined);
  assert.equal(first.sessionReset, false);
  assert.notEqual(first.sessionId, first.customerRef);
  assert.deepEqual(resolveWebChatSession("tenant-a", first.sessionId), first);
  assert.throws(() => resolveWebChatSession("tenant-b", first.sessionId), /Invalid/);
  assert.throws(() => resolveWebChatSession("tenant-a", `${first.sessionId}x`), /Invalid/);
  assert.throws(() => resolveWebChatSession("tenant-a", `${first.sessionId}.`), /Invalid/);
  assert.throws(() => resolveWebChatSession("tenant-a", {}), /Invalid/);
  assert.throws(() => resolveWebChatSession("tenant-a", "x".repeat(4097)), /Invalid/);
});

test("legacy values and known CRM refs never claim an existing customer", () => {
  const old = "web-known-victim";
  const first = resolveWebChatSession("tenant-a", old);
  const second = resolveWebChatSession("tenant-a", old);
  assert.equal(first.sessionReset, true);
  assert.notEqual(first.customerRef, old);
  assert.notEqual(first.customerRef, second.customerRef);
  assert.notEqual(resolveWebChatSession("tenant-a", first.customerRef).customerRef, first.customerRef);
  assert.equal(resolveWebChatSession("tenant-a", first.sessionId).customerRef, first.customerRef);
});

test("expiry, purpose and production secret fail closed", () => {
  const now = Date.now;
  const keys = ["NODE_ENV", "BMS_CHECKOUT_SECRET", "NEXTAUTH_SECRET", "AUTH_SECRET", "JWT_SECRET"];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    const start = now();
    Date.now = () => start;
    const session = resolveWebChatSession("tenant-a", null);
    Date.now = () => start + 30 * 86400_000;
    assert.throws(() => resolveWebChatSession("tenant-a", session.sessionId), /Invalid/);
    Date.now = now;
    const other = signCustomerToken("customer-merge-v1", { tenantId: "tenant-a", customerRef: session.customerRef, exp: Math.floor(now()/1000)+60 });
    assert.throws(() => resolveWebChatSession("tenant-a", other.replace("customer-merge-v1", "web-chat-v1")), /Invalid/);
    keys.forEach(key => delete process.env[key]);
    process.env.NODE_ENV = "production";
    assert.throws(() => resolveWebChatSession("tenant-a", null), /secret is not configured/);
  } finally {
    Date.now = now;
    for (const key of keys) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key];
  }
});

test("real route keeps reply/sessionId contract, rejects forgery before pipeline, and scopes duplicate messages", async () => {
  const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
  const ts = require("typescript");
  const source = readFileSync(new URL("../apps/web/app/api/bms/web/webhook/[tenantId]/route.ts", import.meta.url), "utf8");
  const calls: any[] = [];
  const claimed = new Set<string>();
  const mocks: Record<string, any> = {
    "next/server": { NextResponse: { json: (data: unknown, options: unknown) => ({ data, options }) } },
    "crypto": require("node:crypto"),
    "@/lib/bms/webChatSession": await import("../apps/web/lib/bms/webChatSession.ts"),
    "@/lib/bms/pipeline": { runPipeline: async (...args: any[]) => { calls.push(args); return { reply: "FAKE reply", quality: {} }; } },
    "@/lib/bms/channels": { getChannel: async () => null },
    "@/lib/bms/rateLimit": { rateLimit: async () => ({ ok: true }) },
    "@/lib/bms/inbox": { logConversation: async (...args: any[]) => { calls.push(args); } },
    "@/lib/bms/inboundEvents": { claimInboundEvent: async (_tenant: string, _channel: string, key: string | null) => {
      if (!key) return true;
      const scoped = `${_tenant}:${_channel}:${key}`;
      if (claimed.has(scoped)) return false;
      claimed.add(scoped); return true;
    } },
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
  };
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: (name: string) => { assert.ok(name in mocks, name); return mocks[name]; } });
  const post = (body: unknown, tenantId = "tenant-a", headers: Record<string, string> = {}) =>
    exports.POST({ json: async () => body, headers: new Headers(headers) }, { params: { tenantId } });
  const first = await post({ message: "hello", sessionId: "legacy", messageId: "one" });
  assert.equal(first.data.reply, "FAKE reply");
  assert.equal(first.data.sessionReset, true);
  assert.equal(first.options.headers["cache-control"], "no-store");
  assert.match(first.options.headers["access-control-allow-headers"], /idempotency-key/);
  assert.equal(calls.length, 2);
  assert.ok(!JSON.stringify(calls).includes(first.data.sessionId));
  const ref = calls[0][3];
  const bootstrapRetry = await post({ message: "hello", sessionId: "legacy", messageId: "one" });
  assert.equal(bootstrapRetry.data.duplicate, true);
  assert.notEqual(bootstrapRetry.data.sessionId, first.data.sessionId, "a public retry must never reveal the original bearer token");
  assert.equal(calls.length, 2, "first-message retry cannot run the pipeline again");
  const firstSignedRetry = await post({ message: "hello", sessionId: first.data.sessionId, messageId: "one" });
  assert.equal(firstSignedRetry.data.duplicate, true);
  assert.equal(calls.length, 2);
  const again = await post({ message: "next", sessionId: first.data.sessionId, messageId: "two" });
  assert.equal(calls[2][3], ref);
  assert.equal(again.data.sessionId, first.data.sessionId);
  const duplicate = await post({ message: "next", sessionId: first.data.sessionId, messageId: "two" });
  assert.equal(duplicate.data.duplicate, true);
  assert.equal(calls.length, 4);
  const stranger = await post({ message: "next", messageId: "two" });
  assert.equal(stranger.data.reply, "FAKE reply", "one visitor cannot consume another visitor's message ID");
  for (const [sessionId, tenantId] of [[first.data.sessionId + "x", "tenant-a"], [first.data.sessionId, "tenant-b"]]) {
    const before = calls.length;
    const bad = await post({ message: "history", sessionId }, tenantId);
    assert.equal(bad.options.status, 401);
    assert.equal(calls.length, before);
  }
  const noSession = { message: "FAKE initial order" };
  const header = { "idempotency-key": "FAKE-first-request" };
  const beforeBootstrap = calls.length;
  const newSession = await post(noSession, "tenant-a", header);
  const noSessionRetry = await post(noSession, "tenant-a", header);
  assert.equal(noSessionRetry.data.duplicate, true);
  assert.equal(calls.length, beforeBootstrap + 2);
  assert.notEqual(newSession.data.sessionId, noSessionRetry.data.sessionId);
  const otherTenant = await post(noSession, "tenant-b", header);
  assert.equal(otherTenant.data.reply, "FAKE reply");
  const beforeInvalid = calls.length;
  for (const body of [null, [], "bad", { message: "hello", messageId: "x".repeat(257) }]) {
    const invalid = await post(body);
    assert.equal(invalid.options.status, 400);
  }
  assert.equal(calls.length, beforeInvalid);
});
