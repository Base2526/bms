import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { SHOP_ARCHETYPE_OPTIONS } from "../apps/web/lib/bms/shopArchetypes.ts";

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
  const linuxRelease = read("deploy/retail-local/managed-runtime/linux/prepare-release.sh");
  const releaseExample = JSON.parse(read("deploy/retail-local/managed-runtime/release-descriptor.example.json"));
  assert.match(runner, /pg_advisory_lock/);
  assert.match(runner, /bms_local_schema_migrations/);
  assert.match(runner, /changed after it was applied; refusing to continue/);
  assert.match(runner, /001_normalize_roles_phase1_ROLLBACK\.sql/);
  assert.match(runner, /002_normalize_roles_phase3_cleanup\.sql/);
  assert.match(runner, /tenant\+cough\+diarrhea\.sql/);
  assert.match(runner, /1\.24__roles\.sql/);
  assert.match(runner, /RENAMED_MIGRATIONS/);
  assert.match(runner, /compatibleMigrationChecksums/);
  assert.match(runner, /normalize checksum/);
  assert.match(runner, /10\.26__bms_retail_local_macos_x64_release_assets\.sql/);
  assert.match(runner, /10\.27__bms_onboarding_seed_archetypes\.sql/);
  assert.match(runner, /UPDATE bms_local_schema_migrations SET name = \$1, checksum = \$2 WHERE name = \$3/);
  assert.match(linuxRelease, /schemaVersion: "10\.36"/);
  assert.equal(releaseExample.schemaVersion, "10.36");
  assert.equal(releaseExample.minimumAgentVersion, "0.5.6");
});

test("first-run provisioning is single-tenant, atomic, and never persists the raw device token", () => {
  const service = read("apps/web/lib/bms/localProvisioning.ts");
  const runner = read("apps/web/scripts/retail-local-provision.mts");
  const sampleRunner = read("apps/web/scripts/retail-local-sample-data.mts");
  const migration = read("db/migrations/10.15__bms_retail_local_installation.sql");
  assert.match(service, /BMS_DEPLOYMENT_MODE !== "retail-local"/);
  assert.match(service, /SELECT pg_advisory_xact_lock/);
  assert.match(service, /await client\.query\("BEGIN"\)/);
  assert.match(service, /await client\.query\("COMMIT"\)/);
  assert.match(service, /hashToken\(deviceToken\)/);
  assert.match(service, /normalizeShopArchetype\(input\.businessArchetype \?\? DEFAULT_SHOP_ARCHETYPE\)/);
  assert.match(service, /VALUES \(\$1, \$2, \$3\)/);
  assert.doesNotMatch(service, /VALUES \(\$1, 'general', 'mini_mart'\)/);
  assert.match(runner, /status: "PENDING"/);
  assert.match(runner, /status: "SKIPPED"/);
  assert.doesNotMatch(runner, /createOnboardingSampleData/,
    "sample generation must not delay checkpointing the one-time device token");
  assert.match(sampleRunner, /createOnboardingSampleData\(tenantId\)/);
  assert.match(sampleRunner, /optional sample data failed/);
  assert.doesNotMatch(migration, /device_token|password_hash|pos_pin_hash/i);
  assert.match(migration, /CHECK \(singleton\)/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON bms_local_installation FROM bms_app/);
});

test("every Retail Local installer asks for shop type and optional archetype sample data", () => {
  const installers = [
    read("deploy/retail-local/install.ps1"),
    read("deploy/retail-local/managed-runtime/windows/install-managed-runtime.ps1"),
    read("deploy/retail-local/managed-runtime/linux/install-managed-runtime.sh"),
    read("deploy/retail-local/managed-runtime/macos/bms-retail-local"),
  ];
  for (const installer of installers) {
    assert.match(installer, /BMS_LOCAL_BUSINESS_ARCHETYPE/);
    assert.match(installer, /BMS_LOCAL_SAMPLE_MODE/);
    assert.match(installer, /Create sample data for this shop type|Starter Catalog/);
  }
  for (const compose of [
    read("deploy/retail-local/compose.yml"),
    read("deploy/retail-local/managed-runtime/compose.managed.yml"),
  ]) {
    assert.match(compose, /BMS_LOCAL_BUSINESS_ARCHETYPE/);
    assert.match(compose, /BMS_LOCAL_SAMPLE_MODE/);
    assert.match(compose, /sample-data:/);
    assert.match(compose, /retail-local-sample-data\.mts/);
  }
});

test("installers checkpoint or hand off pairing before optional sample generation", () => {
  const linux = read("deploy/retail-local/managed-runtime/linux/install-managed-runtime.sh");
  const windows = read("deploy/retail-local/managed-runtime/windows/install-managed-runtime.ps1");
  const macos = read("deploy/retail-local/managed-runtime/macos/bms-retail-local");
  const pilot = read("deploy/retail-local/install.ps1");

  const linuxCheckpoint = linux.indexOf('write_runtime_text "$provision_checkpoint"');
  assert.ok(linuxCheckpoint >= 0 && linuxCheckpoint < linux.indexOf("run --rm sample-data"),
    "Linux must persist the token checkpoint before sample data");
  const windowsCheckpoint = windows.indexOf("Write-RuntimeText $provisionCheckpoint");
  assert.ok(windowsCheckpoint >= 0 && windowsCheckpoint < windows.indexOf('"sample-data"'),
    "Windows must persist the token checkpoint before sample data");
  const macCheckpoint = macos.indexOf('mv -f "$root/provision-result.json.pending" "$root/provision-result.json"');
  const macFlush = macos.indexOf('sync -f "$root/provision-result.json.pending"');
  assert.ok(macFlush >= 0 && macFlush < macCheckpoint, "macOS must flush the pending checkpoint before publishing it");
  assert.ok(macCheckpoint >= 0 && macCheckpoint < macos.indexOf("\n  run_sample_data", macCheckpoint),
    "macOS must persist the token checkpoint before sample data");
  assert.match(macos, /case "\$PROVISION_SAMPLE_STATUS" in[\s\S]*COMPLETED\|ALREADY_COMPLETED\) return 0/,
    "macOS must treat skipping completed optional sample data as a successful setup path under set -e");
  const pilotHandoff = pilot.indexOf("Write-Host $result.deviceToken");
  assert.ok(pilotHandoff >= 0 && pilotHandoff < pilot.indexOf("run --rm sample-data"),
    "the technical pilot must display the token before sample data");
});

test("managed installers retry requested sample data and verify restaurant products plus floor", () => {
  const linux = read("deploy/retail-local/managed-runtime/linux/install-managed-runtime.sh");
  const windows = read("deploy/retail-local/managed-runtime/windows/install-managed-runtime.ps1");
  const macos = read("deploy/retail-local/managed-runtime/macos/bms-retail-local");

  assert.doesNotMatch(linux, /read_business_archetype|read_sample_data_choice/,
    "Linux must not call obsolete setup prompts before the signed archetype catalog is available");
  assert.match(linux, /sample_mode == STARTER_CATALOG[\s\S]*sample_status != COMPLETED[\s\S]*sample-data/);
  assert.match(linux, /completedSteps[\s\S]*products[\s\S]*restaurant_layout/);
  assert.match(linux, /\.sampleData\.status \/\/ "SKIPPED"/);

  assert.match(windows, /sampleMode -eq "STARTER_CATALOG"[\s\S]*sampleStatus -notin[\s\S]*"sample-data"/);
  assert.match(windows, /Test-CompletedSampleData[\s\S]*"products"[\s\S]*"restaurant_layout"/);
  assert.match(windows, /sampleMode = \$sampleMode[\s\S]*sampleStatus = \$sampleStatus/);

  assert.match(macos, /completedSteps[\s\S]*"products"[\s\S]*"restaurant_layout"/);
  assert.match(macos, /SAMPLE_MODE != STARTER_CATALOG[\s\S]*Retrying the selected sample data setup/);
});

test("sample products have an explicit preset for every supported shop type", () => {
  const seed = read("apps/web/lib/bms/devSeed.ts");
  const start = seed.indexOf("function productPresetForArchetype");
  const end = seed.indexOf("function orderPresetForArchetype", start);
  assert.ok(start >= 0 && end > start, "cannot locate the sample product preset switch");
  const productPresets = seed.slice(start, end);
  for (const { value } of SHOP_ARCHETYPE_OPTIONS) {
    assert.match(productPresets, new RegExp(`case ["']${value}["']:`), `${value} falls back to generic sample products`);
  }
});

test("restaurant sample data creates an idempotent starter floor without mixing into a real floor", () => {
  const onboarding = read("apps/web/lib/bms/onboardingSampleData.ts");
  const floorSeed = read("apps/web/lib/bms/restaurantSampleData.ts");
  assert.match(onboarding, /restaurant_layout/);
  assert.match(onboarding, /seedRestaurantSampleFloor\(tenantId\)/);
  assert.match(onboarding, /status = 'COMPLETED'[\s\S]{0,160}completed_steps @> \$3::jsonb/);
  assert.match(floorSeed, /createRestaurantArea/);
  assert.match(floorSeed, /createRestaurantTable/);
  assert.match(floorSeed, /listRestaurantFloor/);
  assert.match(floorSeed, /floor\.areas\.length > 0 \|\| floor\.tables\.length > 0/);
  assert.match(floorSeed, /โซนในร้าน \(ตัวอย่าง\)/);
  assert.match(floorSeed, /โซนด้านนอก \(ตัวอย่าง\)/);
  for (let tableNo = 1; tableNo <= 8; tableNo += 1) {
    assert.match(floorSeed, new RegExp(`โต๊ะ ${tableNo}[^0-9]`));
  }
});

test("the resumable sample-data ledger accepts every supported shop type", () => {
  const migrationFiles = readdirSync(new URL("../db/migrations/", import.meta.url))
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const latestConstraintFile = migrationFiles
    .filter((file) => read(`db/migrations/${file}`).includes("bms_onboarding_seed_runs_archetype_check"))
    .at(-1);
  assert.ok(latestConstraintFile, "cannot find the sample-data archetype constraint");
  const migration = read(`db/migrations/${latestConstraintFile}`);
  assert.match(migration, /bms_onboarding_seed_runs_archetype_check/);
  for (const { value } of SHOP_ARCHETYPE_OPTIONS) {
    assert.match(
      migration,
      new RegExp(`['"]${value}['"]`),
      `bms_onboarding_seed_runs rejects the supported ${value} archetype`
    );
  }
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
  assert.match(runtime, /Get-FileHash[\s\S]*checksum mismatch/);
  assert.match(install, /Wait-RetailLocalHealthy/);
  assert.match(install, /Test-RetailLocalHttp/);
});

test("Windows offline pilot produces real EXE variants from a verified server payload", () => {
  const builder = read("deploy/retail-local/windows-offline/build-offline-exe.ps1");
  const inno = read("deploy/retail-local/windows-offline/BMSRetailLocalOffline.iss");
  const readme = read("deploy/retail-local/windows-offline/README.template.md");
  assert.ok(builder.indexOf("Get-FileHash") < builder.indexOf("Expand-Archive"));
  assert.match(builder, /ValidateSet\("server", "server-pos", "all"\)/);
  assert.match(builder, /BMS-Retail-Local-Server-POS-\$Version-windows-x64/);
  assert.match(builder, /BMS-Retail-Local-POS-\$Version-windows-x86-legacy/);
  assert.match(builder, /Set-Content[^\n]+\.sha256/);
  assert.match(inno, /DefaultDirName=\{localappdata\}\\BMS\\Retail Local/);
  assert.match(inno, /Source: "\{#BundleRoot\}\\\*"[^\n]+recursesubdirs/);
  assert.match(inno, /Check: ServerInstallationCompleted/);
  assert.match(inno, /FileExists\(ExpandConstant\('\{app\}\\installation\.json'\)\)/);
  assert.match(inno, /Uninstallable=no/);
  assert.match(builder, /README\.template\.md/);
  assert.match(builder, /Replace\("\{\{SERVER_POS_SHA256\}\}"/);
  assert.match(readme, /PowerShell 7/);
  assert.match(readme, /Docker Desktop/);
  assert.match(readme, /Electron 43[\s\S]{0,120}มกราคม 2027/);
  assert.match(readme, /ไม่มี Emergency Offline Mode/);
  assert.match(readme, /ESC\/POS USB\/LAN ยังไม่ผ่านการรับรองทุกรุ่น/);
});

test("Linux offline pilot produces four x64 installers with verified pinned images", () => {
  const builder = read("deploy/retail-local/linux-offline/build-offline-linux.ps1");
  const debBuilder = read("deploy/retail-local/linux-offline/build-debs.sh");
  const setup = read("deploy/retail-local/linux-offline/bms-retail-local-setup");
  const backup = read("deploy/retail-local/linux-offline/bms-retail-local-backup");
  const readme = read("deploy/retail-local/linux-offline/README.template.md");
  assert.match(builder, /Server ZIP checksum mismatch[\s\S]*docker run --rm/);
  assert.match(builder, /imageSha256/);
  assert.match(builder, /Replace\("`r`n", "`n"\)\.Replace\("`r", "`n"\)/);
  assert.match(builder, /linuxPackageSourceMount/);
  assert.match(builder, /BMS-Retail-Local-Server-POS-\$Version-linux-x64\.deb/);
  assert.match(builder, /BMS-Retail-Local-POS-\$Version-linux-x64\.AppImage/);
  assert.match(debBuilder, /bms-retail-local-server-pos/);
  assert.match(debBuilder, /bms-retail-local-server/);
  assert.match(setup, /sha256sum --check image\.sha256/);
  assert.match(setup, /openssl rand -hex 48/);
  assert.match(setup, /compose --profile setup run --rm provision/);
  assert.match(setup, /127\.0\.0\.1:3100/);
  assert.match(backup, /pg_dump/);
  assert.match(backup, /secrets\.env/);
  assert.match(backup, /SHA256SUMS\.txt/);
  assert.match(readme, /Ubuntu 22\.04 LTS หรือ 24\.04 LTS/);
  assert.match(readme, /Linux x86\/32-bit ไม่มี/);
  assert.match(readme, /basic_text/);
  assert.match(readme, /internal pilot build แบบ unsigned/);
});

test("one release command builds every host-supported installer from a clean versioned commit", () => {
  const builder = read("deploy/retail-local/build-release.ps1");
  const guide = read("deploy/retail-local/BUILD.md");
  assert.match(builder, /npm version \$Version --no-git-tag-version/);
  assert.match(builder, /status --porcelain --untracked-files=normal/);
  assert.match(builder, /ConvertFrom-Json -AsHashtable/);
  assert.match(builder, /package\.ps1/);
  assert.match(builder, /build-offline-exe\.ps1/);
  assert.match(builder, /build-offline-linux\.ps1/);
  assert.match(builder, /managed-runtime\/macos\/build-pkg\.sh/);
  assert.match(builder, /managed-runtime\/macos\/build-bootstrap-pkg\.sh/);
  assert.match(builder, /managed-runtime\/macos\/build-pos-bootstrap-dmg\.sh/);
  assert.match(builder, /MacArm64ManifestUri/);
  assert.match(builder, /MacX64ManifestUri/);
  assert.match(builder, /npm run pack:mac/);
  assert.match(builder, /foreach \(\$architecture in @\("arm64", "x64"\)\)/);
  assert.match(builder, /BMS-Retail-Local-Server-POS-\$Version-x64\.pkg/);
  assert.match(builder, /Target MacOS must be built on macOS/);
  assert.ok(
    builder.indexOf("Build Windows installers") < builder.indexOf("Build Linux installers"),
    "large Windows and Linux packagers must run sequentially"
  );
  assert.match(builder, /release\.sourceCommit -ne \$head/);
  assert.match(builder, /SHA-256 mismatch/);
  assert.match(guide, /-UpdateVersion/);
  assert.match(guide, /git commit -m/);
  assert.match(guide, /-Version 0\.2\.13/);
  assert.match(guide, /Apple Silicon\/Intel/);
  assert.match(guide, /-Target MacOS/);
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
