import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("all online installer families report success and the dashboard exposes OS counts", () => {
  for (const path of [
    "deploy/retail-local/managed-runtime/windows/install-managed-runtime.ps1",
    "deploy/retail-local/managed-runtime/linux/install-managed-runtime.sh",
    "deploy/retail-local/managed-runtime/macos/bms-retail-local",
    "deploy/retail-local/pos-online/windows/install-pos-online.ps1",
    "deploy/retail-local/pos-online/linux/bms-pos-online-setup",
    "deploy/retail-local/managed-runtime/macos/bms-pos-online-setup.command",
  ]) assert.match(read(path), /installation-report[\s\S]*INSTALLED/);
  const service = read("apps/web/lib/bms/retailLocalInstallations.ts");
  assert.match(service, /GROUP BY platform,architecture,package_type,release_version/);
  assert.doesNotMatch(service, /serial|mac_address|hostname|transaction|customer/i);
});

test("POS-only bootstraps keep release downloads and installation reporting on separate origins", () => {
  const windows = read("deploy/retail-local/pos-online/windows/install-pos-online.ps1");
  const linux = read("deploy/retail-local/pos-online/linux/bms-pos-online-setup");
  const macos = read("deploy/retail-local/managed-runtime/macos/bms-pos-online-setup.command");
  assert.match(windows, /installation-report[\s\S]*-control-uri \$ControlUri/);
  assert.doesNotMatch(windows, /installation-report[\s\S]{0,160}-control-uri \$ManifestUri/);
  assert.match(linux, /installation-report[\s\S]*-control-uri "\$control_uri"/);
  assert.match(macos, /installation-report[\s\S]*-control-uri "\$control_uri"/);
  const builder = read("deploy/retail-local/build-online-pos-bootstrap.ps1");
  assert.match(builder, /DControlUri=\$ControlUri/);
  assert.match(builder, /build-deb\.sh[\s\S]*\$ControlUri/);
  assert.match(read("deploy/retail-local/build-release.ps1"), /ControlUri = \$ActivationUri/);
});

test("successful install registry authenticates random installation identities without hardware fingerprints", async () => {
  const global = globalThis as typeof globalThis & { __bmsPostgresPool?: unknown };
  const previous = global.__bmsPostgresPool;
  let storedHash = ""; let inserts = 0; let updates = 0;
  global.__bmsPostgresPool = { async query(sql: string, params: unknown[] = []) {
    if (sql.includes("INSERT INTO bms_retail_local_installation_registry")) { inserts++; storedHash ||= String(params[1]); return { rowCount: 1, rows: [] }; }
    if (sql.includes("UPDATE bms_retail_local_installation_registry")) {
      if (params[1] !== storedHash) return { rowCount: 0, rows: [] };
      updates++; return { rowCount: 1, rows: [{ installation_id: params[0] }] };
    }
    throw new Error("unexpected registry query");
  }};
  try {
    const { recordRetailLocalInstallation } = await import("../apps/web/lib/bms/retailLocalInstallations.ts");
    const secret = "bmsit_" + "x".repeat(43);
    const payload = { formatVersion: 1, installationId: crypto.randomUUID(), event: "INSTALLED",
      packageType: "server-pos", platform: "windows", architecture: "x64", osVersion: "11 23H2",
      platformTarget: "windows-11-x64", releaseVersion: "1.2.3", agentVersion: "0.5.6",
      occurredAt: new Date().toISOString() };
    await recordRetailLocalInstallation(payload, secret);
    assert.equal(inserts, 1); assert.equal(updates, 1);
    assert.equal(storedHash, crypto.createHash("sha256").update(secret).digest("hex"));
    await assert.rejects(recordRetailLocalInstallation({ ...payload, osVersion: "11\nserial=secret" }, secret), /invalid_installation_report/);
    await assert.rejects(recordRetailLocalInstallation(payload, "bmsit_" + "y".repeat(43)), /unauthorized/);
    assert.equal(updates, 1);
  } finally { global.__bmsPostgresPool = previous; }
});
