import assert from "node:assert/strict";
import test from "node:test";
import crypto, { createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import { loadWithStubs } from "./testing/webhookHarness.mts";
import * as storedFileKinds from "../apps/web/lib/bms/storedFileKinds.ts";

// 2026-11-23 recheck: persistWebFile()/persistBuffer() store `files.filename` as
// `${Date.now()}-${safeName}`. Every check written as startsWith("bms-inbox-") or
// LIKE 'bms-inbox-%' therefore never matched a real upload — the Inbox download gate and the
// signed provider media route were dead code, and the old contract only passed because its
// fixture skipped the timestamp. These cases drive the real storage naming end to end.

const previousSecret = process.env.BMS_CHECKOUT_SECRET;
process.env.BMS_CHECKOUT_SECRET = "FAKE-file-download-stored-name-secret";

type FileRow = { id: number; tenant: string; filename: string; visibility: string; relpath: string };
const files = new Map<number, FileRow>();
let nextId = 41;

const storageDb = { query: async (sql: string, values: unknown[]) => {
  assert.match(sql, /INSERT INTO files/);
  const row = { id: nextId++, tenant: String(values[7]), filename: String(values[0]),
    visibility: String(values[6]), relpath: String(values[5]) };
  files.set(row.id, row);
  return { rows: [{ id: row.id, filename: row.filename, original_name: values[1], mimetype: values[2],
    size: values[3], checksum: values[4], relpath: row.relpath }], rowCount: 1 };
} };
const storage = loadWithStubs("apps/web/lib/storage.ts", {
  crypto: { default: crypto }, stream: { Readable }, "@/lib/db": storageDb,
  "@/lib/storageDrivers": { getStorageDriver: () => ({ write: async () => undefined }), toStorageKey: (key: string) => key },
  "@/lib/storageDrivers/local": { STORAGE_DIR: "/tmp/FAKE" },
});

const lookupDb = { query: async (sql: string, values: unknown[]) => {
  const file = files.get(Number(values[0]));
  if (!file || file.tenant !== values[1]) return { rows: [], rowCount: 0 };
  // Emulate the SQL filename predicate the media route uses (old LIKE, or the shared ~ pattern).
  if (sql.includes("filename LIKE 'bms-inbox-%'") && !file.filename.startsWith("bms-inbox-")) return { rows: [], rowCount: 0 };
  if (/filename ~ \$3/.test(sql) && !new RegExp(String(values[2])).test(file.filename)) return { rows: [], rowCount: 0 };
  return { rows: [{ id: file.id, filename: file.filename, visibility: file.visibility, relpath: file.relpath,
    mimetype: "image/png", original_name: "FAKE.png" }], rowCount: 1 };
} };
const media = loadWithStubs("apps/web/lib/bms/inboxMedia.ts", {
  "@/lib/db": lookupDb, "node:crypto": { createHmac, timingSafeEqual }, "@/lib/bms/storedFileKinds": storedFileKinds,
});

class FakeResponse {
  status: number; body: unknown;
  constructor(body: unknown, options: any = {}) { this.body = body; this.status = options.status ?? 200; }
  static json(body: unknown, options: any = {}) { return new FakeResponse(body, options); }
}

async function upload(rename: string, tenant = "tenant-a") {
  const file = new File([Buffer.from("FAKE")], "FAKE.png", { type: "image/png" });
  const row = await storage.persistWebFile(file, rename, "private", tenant, "uploader-a");
  assert.match(row.filename, /^\d+-/, "the storage layer prefixes a timestamp");
  return row;
}

function filesRoute(options: { role: string; permissions: string[]; assigned: boolean; row: FileRow }) {
  const reads = { storage: 0 };
  const route = loadWithStubs("apps/web/app/api/files/[id]/route.ts", {
    "next/server": { NextResponse: FakeResponse },
    "@/lib/db": { query: async (sql: string) => {
      if (sql.includes("FROM files f")) return { rows: [{ id: options.row.id, filename: options.row.filename,
        original_name: "FAKE.png", relpath: options.row.relpath, visibility: "private", tenant_id: options.row.tenant,
        owner_user_id: "uploader-a", mimetype: "image/png", is_chat_file: false }], rowCount: 1 };
      if (sql.includes("FROM bms_generated_reports")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM bms_messages")) return { rows: [{ conversation_id: "conversation-a" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    } },
    path: { default: path },
    stream: { Readable },
    "@/lib/storage": {
      statStoredFile: async () => { reads.storage++; return { size: 4 }; },
      openStoredFileStream: async () => Readable.from([Buffer.from("FAKE")]),
    },
    "@/lib/auth/server": { verifyUserSession: () => null },
    "@/lib/bms/adminRouteAuth": {
      authorizeAdminRoute: async (permission: string | null) => permission && !options.permissions.includes(permission)
        ? { ok: false, status: 403 }
        : { ok: true, tenantId: "tenant-a", adminId: "staff-a", admin: { role: options.role }, ctx: { permissions: options.permissions } },
      authorizePlatformAdminRoute: async () => ({ ok: false, status: 403 }),
    },
    "@/lib/bms/inbox": { canAccessInboxConversation: async () => options.assigned },
    "@/lib/bms/storedFileKinds": storedFileKinds,
    "@/lib/bms/inboxMedia": media,
    "@/lib/bms/reportEngine": {},
    "@/lib/bms/permissions": { requirePermission: async (ctx: { permissions: string[] }, permission: string) => {
      if (!ctx.permissions.includes(permission)) throw new Error("FORBIDDEN");
    } },
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
  });
  const request = { nextUrl: new URL(`https://example.test/api/files/${options.row.id}`), headers: new Headers() };
  return { reads, get: () => route.GET(request, { params: { id: String(options.row.id) } }) };
}

test("a real Inbox upload keeps the Inbox permission and Sales assignment gate on /api/files", async () => {
  const row = files.get((await upload(`bms-inbox-${crypto.randomUUID()}`)).id)!;
  const noInbox = filesRoute({ role: "Kitchen", permissions: [], assigned: true, row });
  assert.equal((await noInbox.get()).status, 404, "same-shop staff without inbox.view");
  const unassigned = filesRoute({ role: "Sales", permissions: ["inbox.view"], assigned: false, row });
  assert.equal((await unassigned.get()).status, 404, "Sales not assigned to the conversation");
  assert.equal(noInbox.reads.storage + unassigned.reads.storage, 0);
  const assigned = filesRoute({ role: "Sales", permissions: ["inbox.view"], assigned: true, row });
  assert.equal((await assigned.get()).status, 200);
});

test("a real Inbox upload can be sent to a provider and fetched through the signed media route", async () => {
  const row = await upload(`bms-inbox-${crypto.randomUUID()}`);
  const signedPath = media.inboxMediaPath("tenant-a", row.id);
  assert.match(await media.outboundInboxMediaUrl("tenant-a", signedPath), /^\/api\/bms\/inbox\/media\/\d+\?token=/);
  const route = loadWithStubs("apps/web/app/api/bms/inbox/media/[id]/route.ts", {
    "next/server": { NextResponse: FakeResponse },
    "node:stream": { Readable },
    "@/lib/db": lookupDb,
    "@/lib/storage": { statStoredFile: async () => ({ size: 4 }), openStoredFileStream: async () => Readable.from([Buffer.from("FAKE")]) },
    "@/lib/bms/inboxMedia": media,
    "@/lib/bms/rateLimit": { rateLimit: async () => ({ ok: true }) },
    "@/lib/log/routeError": { withRouteErrorLog: (_name: string, handler: unknown) => handler },
  });
  const token = media.signInboxMedia("tenant-a", row.id);
  const request = { headers: new Headers(), nextUrl: new URL(`https://example.test/api/bms/inbox/media/${row.id}?token=${encodeURIComponent(token)}`) };
  assert.equal((await route.GET(request, { params: { id: String(row.id) } })).status, 200);

  // An ordinary private file of the same shop is still not an Inbox capability.
  const other = await upload("expense-receipt.png");
  await assert.rejects(media.outboundInboxMediaUrl("tenant-a", media.inboxMediaPath("tenant-a", other.id)));
});

test("customer payment slips need payment.view, not just a same-shop login", async () => {
  for (const rename of ["checkout-ORD-1001-slip.png", "board-game-reservation-FAKE-slip.png"]) {
    const row = files.get((await upload(rename)).id)!;
    const kitchen = filesRoute({ role: "Kitchen", permissions: [], assigned: false, row });
    assert.equal((await kitchen.get()).status, 404, `${rename} without payment.view`);
    assert.equal(kitchen.reads.storage, 0);
    const cashier = filesRoute({ role: "Cashier", permissions: ["payment.view"], assigned: false, row });
    assert.equal((await cashier.get()).status, 200, `${rename} with payment.view`);
  }
});

test("LINE inbound media is stored under the Inbox naming so the Inbox gate applies", async () => {
  const source = (await import("node:fs")).readFileSync(
    new URL("../apps/web/app/api/bms/line/webhook/[tenantId]/route.ts", import.meta.url), "utf8");
  assert.match(source, /persistBuffer\(buf, filename, mimeType, "private", tenantId, `bms-inbox-line-\$\{message\.id\}-\$\{filename\}`\)/);
  assert.equal(media.isInboxStoredFilename("1763900000000-bms-inbox-line-5012-statement.pdf"), true);
  // LINE media stored before the rename keeps its generated name and is recognized too.
  assert.equal(media.isInboxStoredFilename("1763900000000-line-image-5012.jpg"), true);
  assert.equal(media.isInboxStoredFilename("1763900000000-photo-bms-inbox-.jpg"), false);
  assert.equal(media.isInboxStoredFilename("1763900000000-line-image-notes.jpg"), false);
  assert.equal(media.isInboxStoredFilename("bms-inbox-legacy"), true);
});

test.after(() => {
  if (previousSecret === undefined) delete process.env.BMS_CHECKOUT_SECRET;
  else process.env.BMS_CHECKOUT_SECRET = previousSecret;
});
