import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
test("isolated installer intake/list/detail/triage/retention round trip", { skip: process.env.POSTGRES_DB !== "bms_installer_reports_test" }, async () => {
  assert.ok(["127.0.0.1", "localhost"].includes(process.env.POSTGRES_HOST || ""));
  (globalThis as any).AsyncLocalStorage = AsyncLocalStorage;
  const { query, getClient } = await import("../apps/web/lib/db.ts");
  const service = await import("../apps/web/lib/bms/installerReports.ts");
  await query("CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY, is_platform_admin BOOLEAN NOT NULL DEFAULT false)");
  await query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='bms_app') THEN CREATE ROLE bms_app; END IF; END $$");
  const migration = await readFile(new URL("../db/migrations/10.31__bms_installer_reports.sql", import.meta.url), "utf8");
  await query(migration); await query(migration);
  await query("TRUNCATE bms_installer_reports");
  const admin = "11111111-1111-4111-8111-111111111111";
  await query("INSERT INTO users(id,is_platform_admin) VALUES ($1,true) ON CONFLICT(id) DO NOTHING", [admin]);
  const payload = (kernel: string, version: string, time = "2026-10-01T12:00:00Z") => Buffer.from(`formatVersion=1\nproduct=pos\ninstallerVersion=${version}\nstage=download\nerror=download failed\nkernel=${kernel}\narchitecture=x86_64\ncreatedAt=${time}\n`);
  const a = await service.submitInstallerReport(payload("Linux 6.8", "0.2.13"));
  const duplicate = await service.submitInstallerReport(payload("Linux 6.8", "0.2.13"));
  assert.equal(a.reportId, duplicate.reportId);
  await service.submitInstallerReport(payload("Darwin 24.0", "0.2.14"));
  await service.submitInstallerReport(payload("Linux 6.8", "0.2.13", "2026-10-01T13:00:00Z"));
  const list = await service.listInstallerReports(new URLSearchParams());
  assert.equal(list.counts.total, 3); assert.equal(list.groups[0].count, 2);
  assert.equal((await service.listInstallerReports(new URLSearchParams({ platform: "macos", version: "0.2.14" }))).counts.total, 1);
  assert.equal((await service.listInstallerReports(new URLSearchParams({ q: "' OR true --" }))).counts.total, 0);
  for (const params of [{ from: "2026-02-30" }, { to: "2026-02-29" }, { from: "0000-01-01" }, { from: "2026-10-02", to: "2026-10-01" }]) {
    await assert.rejects(service.listInstallerReports(new URLSearchParams(params)), /invalid_date/);
  }
  assert.equal((await service.listInstallerReports(new URLSearchParams({ from: "2024-02-29" }))).counts.total, 3);
  const server = await service.submitInstallerReport(Buffer.from(payload("Linux 6.8", "0.2.13").toString().replace("product=pos", "product=server-pos")));
  const grouped = await service.listInstallerReports(new URLSearchParams());
  assert.equal(grouped.groups.length, 3);
  assert.equal(grouped.groups.find((group: any) => group.product === "server-pos")?.count, 1);
  const group = grouped.groups.find((group: any) => group.product === "server-pos")!;
  const selected = await service.listInstallerReports(new URLSearchParams({ fingerprint: group.fingerprint, product: group.product }));
  assert.equal(selected.counts.total, 1); assert.equal(selected.reports[0].id, server.reportId);
  await query("DELETE FROM bms_installer_reports WHERE id=$1", [server.reportId]);
  let detail = await service.getInstallerReport(a.reportId);
  assert.equal(detail.status, "NEW"); assert.ok(!("content_hash" in detail));
  detail = await service.updateInstallerReport(a.reportId, { status: "INVESTIGATING", note: "Download timed out", revision: 0 }, admin);
  assert.equal(detail.revision, 1); assert.equal(detail.updated_by, admin);
  await assert.rejects(service.updateInstallerReport(a.reportId, { status: "RESOLVED", note: "", revision: 0 }, admin), /report_changed_reload/);
  detail = await service.updateInstallerReport(a.reportId, { status: "RESOLVED", note: "password=PRIVATE", revision: 1 }, admin);
  assert.doesNotMatch(detail.note, /PRIVATE/);
  const client = await getClient();
  try { await client.query("SET ROLE bms_app"); await assert.rejects(client.query("SELECT * FROM bms_installer_reports"), /permission denied/); }
  finally { await client.query("RESET ROLE"); client.release(); }
  await query("UPDATE bms_installer_reports SET expires_at=now()-interval '1 second' WHERE id=$1", [a.reportId]);
  await assert.rejects(service.getInstallerReport(a.reportId), /not_found/);
  assert.equal((await service.listInstallerReports(new URLSearchParams())).counts.total, 2);
  assert.equal(await service.purgeExpiredInstallerReports(), 1);
  // Also verify signed-session guards through the actual route adapters with the Next shim.
  const { GET } = await import("../apps/web/app/api/admin/installer-reports/route.ts");
  const { NextRequest } = require("next/server");
  const { requestAsyncStorage } = require("next/dist/client/components/request-async-storage.external.js");
  const runAs = () => requestAsyncStorage.run({ cookies: { get: () => undefined } },
    () => GET(new NextRequest("http://localhost/api/admin/installer-reports")));
  assert.equal((await runAs()).status, 401);
  const shopAdmin = "22222222-2222-4222-8222-222222222222";
  await query("INSERT INTO users(id) VALUES($1) ON CONFLICT(id) DO NOTHING", [shopAdmin]);
});
