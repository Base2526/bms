import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Retail Local reuses the authoritative stack and keeps data services off host ports", () => {
  const compose = read("deploy/retail-local/compose.yml");
  const dockerfile = read("apps/web/Dockerfile");
  const dockerignore = read(".dockerignore");
  assert.match(compose, /BMS_DEPLOYMENT_MODE: retail-local/);
  assert.match(compose, /127\.0\.0\.1:\$\{BMS_LOCAL_WEB_PORT/);
  assert.match(compose, /127\.0\.0\.1:\$\{BMS_LOCAL_WS_PORT/);
  const postgres = compose.slice(compose.indexOf("  postgres:"), compose.indexOf("  redis:"));
  const redis = compose.slice(compose.indexOf("  redis:"), compose.indexOf("  migrate:"));
  assert.doesNotMatch(postgres, /\n\s+ports:/);
  assert.doesNotMatch(redis, /\n\s+ports:/);
  assert.match(compose, /condition: service_completed_successfully/);
  assert.doesNotMatch(compose, /\.\.\/\.\.\/db:\/app\/db/);
  assert.match(dockerfile, /COPY db \/app\/db/);
  assert.match(dockerignore, /!db\/migrations\/\*\.sql/);
});

test("fresh database bootstrap has no built-in credential and uses the current file schema", () => {
  const init = read("db/init.sql");
  assert.doesNotMatch(init, /changeme/i);
  assert.doesNotMatch(init, /admin@local\.com/i);
  assert.doesNotMatch(init, /CREATE TABLE IF NOT EXISTS files/);
  assert.doesNotMatch(init, /CREATE TABLE IF NOT EXISTS system_logs/);
  assert.match(init, /CREATE EXTENSION IF NOT EXISTS "pg_trgm"/);
});

test("local migration runner is ordered, checksummed, locked, and excludes destructive SQL", () => {
  const runner = read("apps/web/scripts/retail-local-migrate.mjs");
  assert.match(runner, /pg_advisory_lock/);
  assert.match(runner, /bms_local_schema_migrations/);
  assert.match(runner, /changed after it was applied; refusing to continue/);
  assert.match(runner, /001_normalize_roles_phase1_ROLLBACK\.sql/);
  assert.match(runner, /002_normalize_roles_phase3_cleanup\.sql/);
  assert.match(runner, /tenant\+cough\+diarrhea\.sql/);
  assert.match(runner, /1\.24__roles\.sql/);
});

test("first-run provisioning is single-tenant, atomic, and never persists the raw device token", () => {
  const service = read("apps/web/lib/bms/localProvisioning.ts");
  const migration = read("db/migrations/10.15__bms_retail_local_installation.sql");
  assert.match(service, /BMS_DEPLOYMENT_MODE !== "retail-local"/);
  assert.match(service, /SELECT pg_advisory_xact_lock/);
  assert.match(service, /await client\.query\("BEGIN"\)/);
  assert.match(service, /await client\.query\("COMMIT"\)/);
  assert.match(service, /hashToken\(deviceToken\)/);
  assert.doesNotMatch(migration, /device_token|password_hash|pos_pin_hash/i);
  assert.match(migration, /CHECK \(singleton\)/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON bms_local_installation FROM bms_app/);
});

test("Retail Local blocks public SaaS tenant signup", () => {
  const signup = read("apps/web/lib/bms/signup.ts");
  assert.match(signup, /if \(isRetailLocalDeployment\(\)\) return \{ status: "INVALID" \}/);
  assert.match(signup, /if \(isRetailLocalDeployment\(\)\) return \{ status: "INVALID_OR_EXPIRED" \}/);
});

test("operator scripts cover backup, guarded restore, migration-first start, and backup-first update", () => {
  const start = read("deploy/retail-local/start.ps1");
  const backup = read("deploy/retail-local/backup.ps1");
  const restore = read("deploy/retail-local/restore.ps1");
  const update = read("deploy/retail-local/update.ps1");
  assert.ok(start.indexOf("run --rm migrate") < start.indexOf("up -d web ws"));
  assert.match(backup, /pg_dump/);
  assert.match(backup, /secrets\.env/);
  assert.match(backup, /SHA256SUMS\.txt/);
  assert.match(restore, /ConfirmRestore/);
  assert.match(restore, /pg_restore/);
  assert.match(restore, /Get-FileHash/);
  assert.ok(update.indexOf("backup.ps1") < update.indexOf("build migrate ws"));
});

test("portable pilot package contains pinned images and verifies them before install", () => {
  const pack = read("deploy/retail-local/package.ps1");
  const install = read("deploy/retail-local/install.ps1");
  const runtime = read("deploy/retail-local/runtime.ps1");
  assert.match(pack, /docker image save/);
  for (const image of ["bms-retail-local-web", "bms-retail-local-ws", "postgres:16-alpine", "redis:7-alpine"]) {
    assert.ok(pack.includes(image), `package is missing ${image}`);
  }
  assert.match(pack, /imageSha256/);
  assert.match(install, /Import-RetailLocalReleaseImages/);
  assert.match(runtime, /Get-FileHash[\s\S]*checksum ไม่ตรง/);
  assert.match(install, /Wait-RetailLocalHealthy/);
  assert.match(install, /Test-RetailLocalHttp/);
});

test("install diagnostics and destructive reset are explicit and secret-safe", () => {
  const doctor = read("deploy/retail-local/doctor.ps1");
  const uninstall = read("deploy/retail-local/uninstall.ps1");
  const checklist = read("deploy/retail-local/TEST-INSTALL.md");
  assert.match(doctor, /values hidden/);
  assert.doesNotMatch(doctor, /Write-Host[^\n]*(POSTGRES_PASSWORD|JWT_SECRET|BMS_SECRET_KEY)/);
  assert.match(doctor, /bms_local_schema_migrations/);
  assert.match(doctor, /bms_local_installation/);
  assert.match(uninstall, /EraseData/);
  assert.match(uninstall, /ConfirmationText -cne "ERASE-BMS-LOCAL"/);
  assert.match(checklist, /doctor\.ps1 -Json/);
  assert.match(checklist, /Do not use real customer data/);
});

