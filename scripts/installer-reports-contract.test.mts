import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { PassThrough } from "node:stream";
import type { IncomingMessage } from "node:http";
import { normalizeInstallerReport, unpackInstallerReport, readInstallerReportBody, redactInstallerText } from "../apps/web/lib/bms/installerReportFormat.ts";
import { readInstallerReportUpload } from "../apps/web/lib/bms/installerReportUpload.ts";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const tar = require("tar-stream");
const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const windows = {
  formatVersion: 1, product: "server-pos", installerVersion: "0.2.13-pilot.1", stage: "start-services", createdAt: "2026-10-01T12:00:00Z",
  failure: { message: "postgres not healthy", hresult: -1, scriptLine: 123, exceptionType: "System.Exception" },
  machine: { windows: { name: "Windows 11", version: "10.0", build: "26100", architecture: "64-bit" },
    hardware: { ramBytes: 8589934592, logicalProcessors: 8, virtualizationFirmwareEnabled: true, serialNumber: "PRIVATE-SERIAL" },
    systemDisk: { freeBytes: 123456789 }, wsl: { packageVersion: "2.5.0" }, services: [{ name: "WslService", status: "Running" }] },
};
const unix = (kernel = "Linux 6.8", arch = "x86_64") => `formatVersion=1\nproduct=pos\ninstallerVersion=0.2.13\nstage=download\ncreatedAt=2026-10-01T12:00:00Z\nerror=download failed\nexitCode=28\nsourceLine=81\nkernel=${kernel}\narchitecture=${arch}\nos.ID="ubuntu"\nos.VERSION_ID="24.04"\nramKiB=8388608\n`;
async function archive(entries: { name: string; text: string; type?: string }[]) {
  const pack = tar.pack(); const chunks: Buffer[] = [];
  for (const e of entries) pack.entry({ name: e.name, type: e.type || "file" }, e.text);
  pack.finalize();
  for await (const chunk of pack) chunks.push(chunk);
  return gzipSync(Buffer.concat(chunks));
}

test("Windows report preserves diagnostic facts but drops arbitrary fields and identity", () => {
  const result = normalizeInstallerReport(JSON.stringify({ ...windows, tenantId: "fake-tenant", environment: { PASSWORD: "private" }, hostname: "private-host" }));
  assert.equal(result.report.platform, "windows"); assert.equal(result.report.architecture, "x64");
  assert.equal(result.report.hardware.ramBytes, "8589934592"); assert.equal(result.report.failure.code, -1);
  assert.equal(result.report.osBuild, "26100"); assert.match(JSON.stringify(result.report.runtime), /WslService/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-SERIAL|private-host|fake-tenant|PASSWORD/);
});
test("Linux x86/x64 and macOS arm64/Intel are normalized", () => {
  for (const [kernel, arch, platform, architecture] of [["Linux 6.8", "i686", "linux", "x86"], ["Linux 6.8", "x86_64", "linux", "x64"], ["Darwin 24.1", "arm64", "macos", "arm64"], ["Darwin 24.1", "x86_64", "macos", "x64"]]) {
    const result = normalizeInstallerReport(unix(kernel, arch)).report;
    assert.equal(result.platform, platform); assert.equal(result.architecture, architecture); assert.equal(result.failure.code, 28);
  }
  const result = normalizeInstallerReport(JSON.stringify({ ...windows, machine: { ...windows.machine, architecture: "ARM64" } })).report;
  assert.equal(result.architecture, "arm64");
});
test("redaction covers multiline credentials, Thai identity, urls, keys, emails and paths", () => {
  const text = redactInstallerText("postgres stopped\npassword=MY_PASSWORD\nชื่อร้าน: PRIVATE_SHOP\nhttps://example.com/private?secret=123\nprivate@example.com\nC:\\Users\\private\\file\n-----BEGIN RSA PRIVATE KEY-----\nPRIVATEKEY\n-----END RSA PRIVATE KEY-----");
  assert.match(text, /postgres stopped/);
  assert.doesNotMatch(text, /MY_PASSWORD|PRIVATE_SHOP|example.com|Users|PRIVATEKEY/);
});
test("same submission is idempotent, failure grouping ignores timestamps but separates versions", () => {
  const a = normalizeInstallerReport(JSON.stringify(windows));
  const b = normalizeInstallerReport(JSON.stringify({ ...windows, createdAt: "2026-10-02T12:00:00Z" }));
  const c = normalizeInstallerReport(JSON.stringify({ ...windows, installerVersion: "0.2.14" }));
  assert.equal(a.contentHash, normalizeInstallerReport(JSON.stringify(windows)).contentHash);
  assert.notEqual(a.contentHash, b.contentHash); assert.equal(a.fingerprint, b.fingerprint); assert.notEqual(a.fingerprint, c.fingerprint);
});
test("unsupported schemas, malformed and oversized payloads fail closed", () => {
  for (const value of ["{}", "{oops", "[]", "a".repeat(65537), JSON.stringify({ ...windows, formatVersion: 2 }), JSON.stringify({ ...windows, product: "any" })]) assert.throws(() => normalizeInstallerReport(value));
});
test("TAR.GZ is read in memory and only diagnostics are retained", async () => {
  const body = await archive([{ name: "diagnostics.txt", text: unix() }, { name: "README.txt", text: "not stored" }]);
  assert.equal(await unpackInstallerReport(body), unix());
  assert.equal(await unpackInstallerReport(Buffer.from(JSON.stringify(windows))), JSON.stringify(windows));
});
test("Windows .NET ZIP report round trips and rejects an oversized ZIP entry", { skip: process.platform !== "win32" }, async () => {
  const zip = (text: string) => {
    const encoded = Buffer.from(text).toString("base64");
    const command = `Add-Type -AssemblyName System.IO.Compression
$stream = New-Object IO.MemoryStream
$zip = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
$entry = $zip.CreateEntry('diagnostics.json').Open()
$bytes = [Convert]::FromBase64String('${encoded}')
$entry.Write($bytes, 0, $bytes.Length)
$entry.Dispose()
$zip.Dispose()
[Convert]::ToBase64String($stream.ToArray())`;
    return Buffer.from(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", maxBuffer: 1024 * 1024 }).trim(), "base64");
  };
  assert.equal(normalizeInstallerReport(await unpackInstallerReport(zip(JSON.stringify(windows)))).report.platform, "windows");
  // Avoid the Windows argv limit: expand the compressible input inside PowerShell.
  const bombScript = `Add-Type -AssemblyName System.IO.Compression; $s=New-Object IO.MemoryStream; $z=New-Object IO.Compression.ZipArchive($s,[IO.Compression.ZipArchiveMode]::Create,$true); $w=New-Object IO.StreamWriter($z.CreateEntry('diagnostics.json').Open()); $w.Write(('x'*100000)); $w.Dispose(); $z.Dispose(); [Convert]::ToBase64String($s.ToArray())`;
  const bomb = Buffer.from(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", bombScript], { encoding: "utf8" }).trim(), "base64");
  await assert.rejects(unpackInstallerReport(bomb));
});
test("archives reject traversal, symlinks, duplicates, unknown files and decompression bombs", async () => {
  for (const entries of [
    [{ name: "../diagnostics.txt", text: unix() }],
    [{ name: "diagnostics.txt", text: "", type: "symlink" }],
    [{ name: "diagnostics.txt", text: unix() }, { name: "diagnostics.txt", text: unix() }],
    [{ name: ".env", text: "SECRET=PRIVATE" }],
    [{ name: "diagnostics.txt", text: "a".repeat(200000) }],
  ]) await assert.rejects(unpackInstallerReport(await archive(entries)));
  await assert.rejects(unpackInstallerReport(Buffer.from("PKbroken")));
});
test("request limits apply to streaming bodies without Content-Length", async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(40000)); controller.enqueue(new Uint8Array(40000)); controller.close(); } });
  await assert.rejects(readInstallerReportBody(new Request("http://localhost", { method: "POST", body: stream, duplex: "half" } as RequestInit)), /payload_too_large/);
  assert.equal((await readInstallerReportBody(new Request("http://localhost", { method: "POST", body: "test" }))).toString(), "test");
});
test("intake has consent, deployment opt-in, rate limits and no public GET; admin APIs always guard", async () => {
  const route = await read("apps/web/pages/api/installer-reports.ts");
  assert.match(route, /BMS_INSTALLER_REPORTS_ENABLED !== "true"/);
  assert.match(route, /x-bms-report-consent/); assert.match(route, /installer-report:fleet/); assert.match(route, /installer-report:source/);
  assert.doesNotMatch(route, /export.*GET|request\.text\(|request\.json\(/);
  assert.match(route, /bodyParser: false/);
  assert.match(route, /req.method !== "POST"/);
  assert.match(route, /readInstallerReportUpload\(req\)/);
  assert.match(route, /setHeader\("Connection", "close"\)/);
  assert.match(await read("apps/web/middleware.ts"), /releases-upload\|api\/installer-reports\|/);
  for (const path of ["apps/web/app/api/admin/installer-reports/route.ts", "apps/web/app/api/admin/installer-reports/[id]/route.ts"]) {
    const source = await read(path); assert.match(source, /await authorizePlatformAdminRoute\(\)/); assert.match(source, /if \(!auth.ok\)/); assert.match(source, /no-store/);
  }
  const mutation = await read("apps/web/app/api/admin/installer-reports/[id]/route.ts");
  assert.match(mutation, /get\("origin"\) !== request.nextUrl.origin/);
});

const uploadStream = (headers = {}) => Object.assign(new PassThrough(), { headers }) as unknown as IncomingMessage;
test("raw Node uploads are bounded without buffering through the Next Request adapter", async () => {
  const normal = uploadStream();
  const body = readInstallerReportUpload(normal);
  (normal as any).end("report");
  assert.equal((await body).toString(), "report");
  assert.equal(normal.listenerCount("data"), 0);
  const declared = uploadStream({ "content-length": "65537" });
  await assert.rejects(readInstallerReportUpload(declared), /payload_too_large/);
  const chunked = uploadStream();
  const oversized = assert.rejects(readInstallerReportUpload(chunked), /payload_too_large/);
  (chunked as any).write(Buffer.alloc(40000));
  (chunked as any).write(Buffer.alloc(40000));
  await oversized;
  assert.equal(chunked.isPaused(), true);
  assert.equal(chunked.listenerCount("data"), 0);
});
test("raw uploads reject a disconnect and time out when no data arrives", async (t) => {
  const aborted = uploadStream();
  const disconnected = assert.rejects(readInstallerReportUpload(aborted), /request_aborted/);
  aborted.emit("aborted");
  await disconnected;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stalled = uploadStream();
  const timeout = assert.rejects(readInstallerReportUpload(stalled), /request_timeout/);
  t.mock.timers.tick(15000);
  await timeout;
  assert.equal(stalled.isPaused(), true);
  assert.equal(stalled.listenerCount("data"), 0);
});
test("retention and platform isolation cannot fall back to tenant access", async () => {
  const migration = await read("db/migrations/10.31__bms_installer_reports.sql");
  assert.match(migration, /REVOKE ALL ON bms_installer_reports FROM bms_app/);
  assert.match(migration, /90 days/);
  const service = await read("apps/web/lib/bms/installerReports.ts");
  assert.match(service, /revision=revision\+1/); assert.match(service, /expires_at>now\(\)/); assert.match(service, /LIMIT 1000/);
  assert.match(await read("apps/web/app/api/bms/support-diagnostics/purge-expired/route.ts"), /purgeExpiredInstallerReports\(\)/);
});
test("Windows/Linux/macOS report producers expose consented BMS submission", async () => {
  for (const path of ["deploy/retail-local/managed-runtime/windows/BMSRetailLocal.iss", "deploy/retail-local/pos-online/windows/BMSPOSOnline.iss", "deploy/retail-local/managed-runtime/setup-diagnostics.sh", "deploy/retail-local/managed-runtime/windows/setup-diagnostics.ps1"]) {
    assert.match(await read(path), /https:\/\/bms\.jachoei\.com\/installer-report/);
  }
});
