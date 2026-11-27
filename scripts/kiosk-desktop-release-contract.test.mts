import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import test from "node:test";
import {
  kioskReleaseMayDownload, kioskReleaseMayPublish, validateKioskReleaseMetadata,
} from "../apps/web/lib/bms/kioskDesktopReleasePolicy.ts";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("Kiosk release identity rejects POS packages, mismatched versions, channels and checksums", () => {
  const base = { filename: "BMS-Kiosk-Setup-0.1.0-pilot.2-x64.exe", size: 100,
    storedSha256: sha("binary"), expectedSha256: sha("binary"), version: "0.1.0-pilot.2",
    channel: "pilot", minOs: "Windows 10 x64", releaseNotes: "pilot" };
  assert.deepEqual(validateKioskReleaseMetadata(base)?.version, base.version);
  for (const patch of [
    { filename: "BMS-POS-Plus-Setup-0.1.0-pilot.2-x64.exe" },
    { filename: "BMS-Kiosk-Setup-0.1.0-pilot.3-x64.exe" },
    { filename: "BMS-Kiosk-Setup-0.1.0-pilot.2-x86.exe" },
    { version: "0.1.0-pilot.3" }, { version: "not-semver" }, { channel: "internal" },
    { expectedSha256: sha("other") }, { size: 0 }, { minOs: "" },
  ]) assert.equal(validateKioskReleaseMetadata({ ...base, ...patch }), null);
});

test("draft, hidden, unsigned and tampered releases are never eligible for download", () => {
  const publish = { status: "DRAFT", integrity: true, signatureStatus: "VALID" };
  assert.equal(kioskReleaseMayPublish(publish), true);
  assert.equal(kioskReleaseMayPublish({ ...publish, integrity: false }), false);
  assert.equal(kioskReleaseMayPublish({ ...publish, signatureStatus: "INVALID" }), false);
  assert.equal(kioskReleaseMayPublish({ ...publish, status: "HIDDEN" }), false);
  const download = { status: "PUBLISHED", signatureStatus: "VALID", branchGrantActive: true, fileIntegrity: true };
  assert.equal(kioskReleaseMayDownload(download), true);
  for (const patch of [{ status: "DRAFT" }, { status: "HIDDEN" },
    { signatureStatus: "UNAVAILABLE" }, { branchGrantActive: false }, { fileIntegrity: false }]) {
    assert.equal(kioskReleaseMayDownload({ ...download, ...patch }), false);
  }
});

test("Kiosk multipart upload streams bytes with its own fields and bound", async (t) => {
  const { __setStorageDriverForTest } = await import("../apps/web/lib/storageDrivers/index.ts");
  let received = 0;
  __setStorageDriverForTest({ name: "kiosk-upload-test", shared: false,
    async write() {}, async delete() {}, async read() { return Buffer.alloc(0); },
    async stat() { return null; }, async openStream() { return Readable.from([]); },
    async writeStream(_key, stream) {
      const hash = createHash("sha256");
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        received += chunk.length; hash.update(chunk);
      }
      return { size: received, checksum: hash.digest("hex") };
    },
  });
  t.after(() => __setStorageDriverForTest(null));
  const { parseRetailLocalReleaseUploadStream } = await import("../apps/web/lib/bms/retailLocalReleaseUpload.ts");
  const options = { maxBytes: 32, allowedFields: ["version", "channel", "sha256", "minOs", "releaseNotes"],
    requiredBeforeFile: ["version", "channel", "sha256", "minOs"] };
  const form = new FormData();
  form.append("version", "0.1.0-pilot.2"); form.append("channel", "pilot");
  form.append("sha256", sha("binary")); form.append("minOs", "Windows 10 x64");
  form.append("file", new Blob(["binary"]), "BMS-Kiosk-Setup-0.1.0-pilot.2-x64.exe");
  const req = new Request("http://localhost/upload", { method: "POST", body: form });
  const parsed = await parseRetailLocalReleaseUploadStream(
    Readable.fromWeb(req.body as any), Object.fromEntries(req.headers), options);
  assert.equal(parsed.storedFile.size, 6);
  assert.equal(parsed.storedFile.checksum, sha("binary"));
  assert.equal(received, 6);
  assert.equal(parsed.fields.version, "0.1.0-pilot.2");
  const oversized = new FormData();
  oversized.append("version", "0.1.0-pilot.2"); oversized.append("channel", "pilot");
  oversized.append("sha256", sha("x".repeat(40))); oversized.append("minOs", "Windows 10 x64");
  oversized.append("file", new Blob(["x".repeat(40)]), "BMS-Kiosk-Setup-0.1.0-pilot.2-x64.exe");
  const largeRequest = new Request("http://localhost/upload", { method: "POST", body: oversized });
  await assert.rejects(parseRetailLocalReleaseUploadStream(
    Readable.fromWeb(largeRequest.body as any), Object.fromEntries(largeRequest.headers), options),
  (error: unknown) => (error as { status?: number }).status === 413);
});

test("signature verification reads actual bytes and never approves unsigned or altered data", async (t) => {
  const { __setStorageDriverForTest } = await import("../apps/web/lib/storageDrivers/index.ts");
  const payload = Buffer.from("unsigned kiosk fixture");
  __setStorageDriverForTest({ name: "kiosk-signature-test", shared: false,
    async write() {}, async delete() {}, async read() { return payload; },
    async stat() { return { size: payload.length }; },
    async openStream() { return Readable.from([payload]); },
    async writeStream() { return { size: 0, checksum: sha("") }; },
  });
  t.after(() => __setStorageDriverForTest(null));
  const { verifyStoredKioskInstaller } = await import("../apps/web/lib/bms/kioskDesktopSignature.ts");
  const verified = await verifyStoredKioskInstaller("fixture", sha(payload.toString()), payload.length);
  assert.equal(verified.integrity, true);
  if (process.platform === "win32") assert.equal(verified.signature.status, "INVALID");
  assert.notEqual(verified.signature.status, "VALID");
  const altered = await verifyStoredKioskInstaller("fixture", sha("different"), payload.length);
  assert.equal(altered.integrity, false);
  assert.equal(altered.signature.status, "INVALID");
});

test("release migration and routes preserve branch scope, RLS and private streaming", async () => {
  const migration = await read("db/migrations/10.147__bms_kiosk_desktop_releases.sql");
  const service = await read("apps/web/lib/bms/kioskDesktopReleases.ts");
  const download = await read("apps/web/app/api/bms/kiosk-desktop-releases/[id]/download/route.ts");
  const upload = await read("apps/web/pages/api/admin/kiosk-desktop-releases-upload.ts");
  const generic = await read("apps/web/app/api/files/[id]/route.ts");
  assert.match(migration, /UNIQUE \(app_kind, platform, channel, version\)/);
  assert.match(migration, /FOREIGN KEY \(tenant_id, location_id\)/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /create_revision_trigger\('bms_kiosk_desktop_release_branches'\)/);
  assert.match(service, /beginTenantTx\(client, input\.tenantId/);
  assert.match(service, /kioskTenantRead\(input\.tenantId/);
  assert.match(service, /inspectStoredFile/);
  assert.match(download, /authorizeAdminRoute\("restaurant\.floor\.manage"\)/);
  assert.match(download, /userCanAccessLocation/);
  assert.match(download, /distributedRateLimit/);
  assert.match(upload, /authorizePlatformAdminCookieHeader/);
  assert.match(upload, /bodyParser: false/);
  assert.match(generic, /"\.exe"/);
});
