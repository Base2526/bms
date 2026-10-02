import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Retail Local releases distinguish combined, server, and POS packages", () => {
  const migration = read("db/migrations/10.20__bms_retail_local_release_package_types.sql");
  const trialLockMigration = read("db/migrations/10.27__bms_retail_local_release_trial_lock.sql");
  const publicCombinedMigration = read("db/migrations/10.32__bms_retail_local_public_combined_installers.sql");
  const windowsX86Migration = read("db/migrations/10.33__bms_retail_local_windows_x86_legacy_release_assets.sql");
  const windowsX86RepairMigration = read("db/migrations/10.34__bms_retail_local_reclassify_windows_x86_legacy_assets.sql");
  const service = read("apps/web/lib/bms/retailLocalReleases.ts");
  const publicPage = read("apps/web/app/(main)/retail-local/RetailLocalPageClient.tsx");
  const publicServerPage = read("apps/web/app/(main)/retail-local/page.tsx");
  const adminPage = read("apps/web/app/(admin)/admin/retail-local-releases/page.tsx");
  const uploadRoute = read("apps/web/pages/api/admin/retail-local/releases-upload.ts");
  const downloadRoute = read("apps/web/app/api/retail-local/download/[id]/route.ts");

  assert.match(migration, /DEFAULT 'server'/);
  assert.match(migration, /'server-pos', 'server', 'pos'/);
  assert.match(migration, /\(platform, package_type\)[\s\S]*WHERE is_latest/);
  assert.match(trialLockMigration, /access_level TEXT NOT NULL DEFAULT 'public'/);
  assert.match(trialLockMigration, /package_type = 'server-pos'[\s\S]*access_level = 'trial'/);
  assert.match(publicCombinedMigration, /DROP CONSTRAINT IF EXISTS bms_retail_local_release_assets_server_pos_trial_lock_check/);
  assert.match(publicCombinedMigration, /public assets appear on \/retail-local/);
  assert.match(windowsX86Migration, /'windows-x86-legacy'/);
  assert.match(windowsX86Migration, /platform <> 'windows-x86-legacy' OR package_type = 'pos'/);
  assert.match(windowsX86RepairMigration, /SET platform = 'windows-x86-legacy'/);
  assert.match(windowsX86RepairMigration, /platform = 'windows-x64'/);
  assert.match(windowsX86RepairMigration, /package_type = 'pos'/);
  assert.match(windowsX86RepairMigration, /x86\|ia32/);
  assert.match(windowsX86RepairMigration, /x86\[_-\]\?64/);

  assert.match(service, /packageType === "pos" \? \["\.dmg"\] : \["\.pkg"\]/);
  assert.match(service, /windows-x86-legacy supports POS Desktop only/);
  assert.match(service, /x86 installer must use the windows-x86-legacy platform/);
  assert.match(service, /WHERE platform = \$1 AND package_type = \$2/);
  assert.match(service, /access_level = 'public'/);
  assert.match(service, /input\.accessLevel == null \? "public" : assertAccessLevel/);
  assert.match(service, /access_level: row\.access_level \?\? "public"/);
  assert.doesNotMatch(service, /server-pos package must be trial locked/);
  assert.match(downloadRoute, /authorizePlatformAdminRoute/);
  assert.match(downloadRoute, /includeTrialLocked: auth\.ok/);
  assert.match(uploadRoute, /parseRetailLocalReleaseUploadStream\(req, req\.headers\)/);
  assert.match(uploadRoute, /packageType: fields\.packageType/);
  assert.match(uploadRoute, /accessLevel: fields\.accessLevel/);

  for (const packageType of ["server-pos", "server", "pos"]) {
    assert.match(publicPage, new RegExp(`"${packageType}"`));
  }
  assert.match(adminPage, /name="packageType"/);
  assert.match(adminPage, /name="accessLevel"/);
  assert.match(adminPage, /notesHint/);
  assert.match(adminPage, /rollback\/restore/);
  assert.match(adminPage, /lower\.endsWith\("\.dmg"\)/);
  assert.match(adminPage, /uploadPackageType === "pos" \? "\.dmg" : "\.pkg"/);
  assert.match(adminPage, /macOS Apple Silicon \(\$\{macUploadExtension\}\)/);
  assert.match(adminPage, /Windows x86 Legacy · POS only/);
  assert.match(adminPage, /platform === "windows-x86-legacy" \? "pos"/);
  assert.match(adminPage, /accessLevel: "public"/);
  assert.doesNotMatch(adminPage, /disabled=\{uploadPackageType === "server-pos"\}/);
  assert.match(publicPage, /releaseNotesLabel/);
  assert.match(publicPage, /directDownload\?\.releaseNotes/);
  assert.match(publicPage, /backup, downtime, and rollback/);
  assert.match(publicServerPage, /"macos-arm64": emptyDownloads\(\)/);
  assert.match(publicServerPage, /"macos-x64": emptyDownloads\(\)/);
  assert.match(publicServerPage, /"windows-x86-legacy": emptyDownloads\(\)/);
  assert.match(publicServerPage, /platform === "windows-x86-legacy"/);
  assert.doesNotMatch(publicServerPage, /return "macos"/);
  assert.match(publicPage, /macArchitectureTitle/);
  assert.match(publicPage, /downloads\[downloadPlatform\]/);
  assert.match(publicPage, /macOS Apple Silicon \(arm64\)/);
  assert.match(publicPage, /macOS Intel \(x64\)/);
  assert.match(publicPage, /downloadPlatform === "windows-x86-legacy"/);
  assert.match(publicPage, /Windows x86 Legacy/);
  assert.match(publicPage, /availablePackageTypes\.map/);
});

test("Retail Local installer upload streams to storage with bounded memory", () => {
  const adminPage = read("apps/web/app/(admin)/admin/retail-local-releases/page.tsx");
  const adminRoute = read("apps/web/app/api/admin/retail-local/releases/route.ts");
  const uploadRoute = read("apps/web/pages/api/admin/retail-local/releases-upload.ts");
  const upload = read("apps/web/lib/bms/retailLocalReleaseUpload.ts");
  const nodeAuth = read("apps/web/lib/bms/platformAdminNodeAuth.ts");
  const middleware = read("apps/web/middleware.ts");
  const storage = read("apps/web/lib/storage.ts");
  const service = read("apps/web/lib/bms/retailLocalReleases.ts");
  const local = read("apps/web/lib/storageDrivers/local.ts");
  const s3 = read("apps/web/lib/storageDrivers/s3.ts");

  assert.doesNotMatch(adminPage, /file\.arrayBuffer\(\)/);
  assert.doesNotMatch(adminRoute, /request\.formData\(\)/);
  assert.doesNotMatch(adminRoute, /parseRetailLocalReleaseUpload/);
  assert.match(adminPage, /\/api\/admin\/retail-local\/releases-upload/);
  assert.match(uploadRoute, /bodyParser: false/);
  assert.match(uploadRoute, /parseRetailLocalReleaseUploadStream\(req, req\.headers\)/);
  assert.doesNotMatch(uploadRoute, /NextRequest|Readable\.fromWeb|request\.formData/);
  assert.match(nodeAuth, /verifyTokenString\(token\)/);
  assert.match(nodeAuth, /is_platform_admin/);
  assert.doesNotMatch(nodeAuth, /^import ["']server-only["'];?$/m);
  assert.match(middleware, /\(\?!api\/admin\/retail-local\/releases-upload\|/);
  assert.match(upload, /Busboy\(/);
  assert.match(upload, /parseRetailLocalReleaseUploadStream/);
  assert.doesNotMatch(upload, /Readable\.fromWeb|request\.body/);
  assert.match(upload, /fileSize: limit/);
  assert.match(upload, /writeWebFileStream\(file/);
  assert.match(storage, /getStorageDriver\(\)\.writeStream\(key, stream\)/);
  assert.match(service, /INSERT INTO files[\s\S]*INSERT INTO bms_retail_local_release_assets/);
  assert.match(service, /deleteStoredFile\(input\.storedFile\.relpath\)/);
  assert.match(local, /partial local storage upload cleanup failed/);
  assert.match(s3, /initiate multipart/);
  assert.match(s3, /partNumber: String\(number\), uploadId/);
  assert.match(s3, /complete multipart/);
  assert.doesNotMatch(s3, /Buffer\.concat\(chunks\)/);
});
