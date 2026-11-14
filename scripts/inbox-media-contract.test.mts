import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { loadWithStubs } from "./testing/webhookHarness.mts";

const previousSecret = process.env.BMS_CHECKOUT_SECRET;
process.env.BMS_CHECKOUT_SECRET = "FAKE-inbox-media-contract-secret";

const files = new Map<number, { tenant: string; filename: string; visibility: string; relpath: string }>([
  [11, { tenant: "tenant-a", filename: "bms-inbox-FAKE", visibility: "private", relpath: "safe/FAKE" }],
  [12, { tenant: "tenant-b", filename: "bms-inbox-OTHER", visibility: "private", relpath: "safe/OTHER" }],
  [13, { tenant: "tenant-a", filename: "product.jpg", visibility: "public", relpath: "safe/PRODUCT" }],
]);
const db = { query: async (sql: string, values: unknown[]) => {
  const file = files.get(Number(values[0]));
  if (!file || file.tenant !== values[1]) return { rows: [], rowCount: 0 };
  if (sql.includes("filename LIKE") && !file.filename.startsWith("bms-inbox-")) return { rows: [], rowCount: 0 };
  return { rows: [{ id: values[0], filename: file.filename, visibility: file.visibility,
    relpath: file.relpath, mimetype: "image/png", original_name: "FAKE.png" }], rowCount: 1 };
} };
const media = loadWithStubs("apps/web/lib/bms/inboxMedia.ts", {
  "@/lib/db": db, "node:crypto": { createHmac, timingSafeEqual },
});

test("Inbox media tokens are scoped to tenant and file and reject tampering or expiry", () => {
  const token = media.signInboxMedia("tenant-a", 11);
  assert.deepEqual(media.verifyInboxMedia(token), { tenantId: "tenant-a", fileId: 11 });
  assert.equal(media.verifyInboxMedia(`${token}x`), null);
  const past = Date.now;
  try {
    Date.now = () => past() + 31 * 24 * 60 * 60 * 1000;
    assert.equal(media.verifyInboxMedia(token), null);
  } finally { Date.now = past; }
});

test("outbound files require upload proof, reject another tenant and retain public product images", async () => {
  const signed = media.inboxMediaPath("tenant-a", 11);
  assert.match(await media.outboundInboxMediaUrl("tenant-a", signed), /^\/api\/bms\/inbox\/media\/11\?token=/);
  await assert.rejects(media.outboundInboxMediaUrl("tenant-b", signed));
  await assert.rejects(media.outboundInboxMediaUrl("tenant-a", "/api/files/11"));
  await assert.rejects(media.outboundInboxMediaUrl("tenant-a", media.inboxMediaPath("tenant-a", 12)));
  assert.equal(await media.outboundInboxMediaUrl("tenant-a", "/api/files/13"), "/api/files/13");
});

test("public media route fails closed before storage and serves only a matching signed private file", async () => {
  let storageReads = 0;
  class FakeResponse {
    status: number; headers: unknown; body: unknown;
    constructor(body: unknown, options: any = {}) { this.body = body; this.status = options.status ?? 200; this.headers = options.headers; }
    static json(body: unknown, options: any = {}) { return new FakeResponse(body, options); }
  }
  const route = loadWithStubs("apps/web/app/api/bms/inbox/media/[id]/route.ts", {
    "next/server": { NextResponse: FakeResponse },
    "node:stream": { Readable },
    "@/lib/db": db,
    "@/lib/storage": {
      statStoredFile: async () => { storageReads++; return { size: 4 }; },
      openStoredFileStream: async () => Readable.from([Buffer.from("FAKE")]),
    },
    "@/lib/bms/inboxMedia": media,
    "@/lib/bms/rateLimit": { rateLimit: async () => ({ ok: true }) },
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
  });
  const request = (token: string) => ({ headers: new Headers(), nextUrl: new URL(`https://example.test/api/bms/inbox/media/11?token=${encodeURIComponent(token)}`) });
  assert.equal((await route.GET(request("bad"), { params: { id: "11" } })).status, 404);
  assert.equal(storageReads, 0);
  const good = media.signInboxMedia("tenant-a", 11);
  assert.equal((await route.GET(request(good), { params: { id: "12" } })).status, 404);
  const response = await route.GET(request(good), { params: { id: "11" } });
  assert.equal(response.status, 200);
  assert.equal(storageReads, 1);
});

test("Inbox upload binds the server tenant and actor, and rejects oversized input before storage", async () => {
  const writes: unknown[][] = [];
  const upload = loadWithStubs("apps/web/app/api/bms/inbox/upload/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, options: any = {}) => ({ body, status: options.status ?? 200 }) } },
    "@/lib/storage": { persistWebFile: async (...args: unknown[]) => { writes.push(args); return { id: 11, original_name: "FAKE.png", mimetype: "image/png" }; } },
    "@/lib/bms/inboxMedia": media,
    "@/lib/bms/adminRouteAuth": { authorizeAdminRoute: async () => ({ ok: true, tenantId: "tenant-a", adminId: "actor-a" }) },
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
    "node:crypto": { randomUUID: () => "FAKE-uuid" },
  });
  const small = new File([Buffer.from("FAKE")], "FAKE.png", { type: "image/png" });
  const accepted = await upload.POST({ formData: async () => new Map([["file", small]]) });
  assert.equal(accepted.status, 200);
  assert.match(accepted.body.url, /^\/api\/bms\/inbox\/media\/11\?token=/);
  assert.deepEqual(writes[0].slice(1), ["bms-inbox-FAKE-uuid", "private", "tenant-a", "actor-a"]);
  const large = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "too-large.png", { type: "image/png" });
  assert.equal((await upload.POST({ formData: async () => new Map([["file", large]]) })).status, 413);
  assert.equal(writes.length, 1);
});

test("staff file download denies unrelated Sales before reading storage", async () => {
  let allowed = false;
  let storageReads = 0;
  class FakeResponse {
    status: number;
    constructor(_body: unknown, options: any = {}) { this.status = options.status ?? 200; }
    static json(body: unknown, options: any = {}) { return new FakeResponse(body, options); }
  }
  const route = loadWithStubs("apps/web/app/api/files/[id]/route.ts", {
    "next/server": { NextResponse: FakeResponse },
    "@/lib/db": { query: async (sql: string) => {
      if (sql.includes("FROM files f")) return { rows: [{ id: 11, filename: "bms-inbox-FAKE", original_name: "FAKE.png",
        relpath: "safe/FAKE", visibility: "private", tenant_id: "tenant-a", owner_user_id: "other-actor",
        mimetype: "image/png", is_chat_file: false }], rowCount: 1 };
      if (sql.includes("FROM bms_generated_reports")) return { rows: [], rowCount: 0 };
      return { rows: [{ conversation_id: "conversation-a" }], rowCount: 1 };
    } },
    "path": { default: path },
    "stream": { Readable },
    "@/lib/storage": {
      statStoredFile: async () => { storageReads++; return { size: 4 }; },
      openStoredFileStream: async () => Readable.from([Buffer.from("FAKE")]),
    },
    "@/lib/auth/server": { verifyUserSession: () => null },
    "@/lib/bms/adminRouteAuth": { authorizeAdminRoute: async () => ({ ok: true, tenantId: "tenant-a",
      adminId: "sales-a", admin: { role: "Sales" } }), authorizePlatformAdminRoute: async () => ({ ok: false, status: 403 }) },
    "@/lib/bms/inbox": { canAccessInboxConversation: async () => allowed },
    "@/lib/bms/reportEngine": {}, "@/lib/bms/permissions": {},
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
  });
  const request = { nextUrl: new URL("https://example.test/api/files/11"), headers: new Headers() };
  assert.equal((await route.GET(request, { params: { id: "11" } })).status, 404);
  assert.equal(storageReads, 0);
  allowed = true;
  assert.equal((await route.GET(request, { params: { id: "11" } })).status, 200);
  assert.equal(storageReads, 1);
});

test.after(() => {
  if (previousSecret === undefined) delete process.env.BMS_CHECKOUT_SECRET;
  else process.env.BMS_CHECKOUT_SECRET = previousSecret;
});
