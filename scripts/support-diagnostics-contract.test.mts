import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");
const code = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "")
  .replace(/^[ \t]*--.*$/gm, "");

test("diagnostic storage is tenant scoped, append-only and bounded", async () => {
  const migration = code(await read("db/migrations/9.46__bms_support_diagnostics.sql"));
  for (const table of ["bms_support_events", "bms_support_bundles"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(migration, new RegExp(`ALTER TABLE %I ENABLE ROW LEVEL SECURITY`));
    assert.match(migration, new RegExp(`ALTER TABLE %I FORCE ROW LEVEL SECURITY`));
  }
  assert.match(migration, /GRANT SELECT, INSERT ON bms_support_events TO bms_app/);
  assert.doesNotMatch(migration, /GRANT[^;]*DELETE[^;]*bms_support_events/);
  assert.match(migration, /range_to - range_from <= interval '7 days'/);
  assert.match(migration, /support\.logs\.view/);
  assert.match(migration, /support\.logs\.export/);
  assert.match(migration, /support\.logs\.send/);
  assert.match(migration, /client_event_id UUID NOT NULL/);
  assert.match(migration, /uq_bms_support_events_client_event/);
  assert.match(migration, /CREATE POLICY system_logs_bms_app_tenant_read/);
  assert.match(migration, /GRANT SELECT ON system_logs TO bms_app/);
  assert.match(migration, /status IN \('EXPORTED','SENT','PURGED'\)/);
  assert.match(migration, /idx_bms_support_bundles_expired_cleanup/);
  assert.match(migration, /idx_support_tickets_diagnostic_bundle/);
});

test("expired private bundles are claimed once and physically purged", async () => {
  const service = code(await read("apps/web/lib/bms/supportDiagnostics.ts"));
  const route = code(await read("apps/web/app/api/bms/support-diagnostics/purge-expired/route.ts"));
  const driver = code(await read("apps/web/lib/storageDrivers/index.ts"));
  const local = code(await read("apps/web/lib/storageDrivers/local.ts"));
  const s3 = code(await read("apps/web/lib/storageDrivers/s3.ts"));
  assert.match(service, /purgeExpiredSupportBundles/);
  assert.match(service, /FOR UPDATE SKIP LOCKED/);
  assert.match(service, /cleanup_claimed_at < now\(\) - interval '15 minutes'/);
  assert.match(service, /deleteStoredFile/);
  assert.match(service, /status = 'PURGED'/);
  assert.match(route, /authorizeCronRequest\(req\)/);
  assert.match(route, /recordJobRun\(\s*"support-diagnostics-retention"/s);
  assert.match(driver, /delete\(relpath: string\): Promise<void>/);
  assert.match(local, /await unlink\(resolveWithin\(relpath\)\)/);
  assert.match(s3, /s3Fetch\(cfg, "DELETE", relpath\)/);
});

test("ingestion allowlists context and never trusts a tenant from the body", async () => {
  const service = code(await read("apps/web/lib/bms/supportDiagnostics.ts"));
  const route = code(await read("apps/web/app/api/bms/support-diagnostics/events/route.ts"));
  assert.match(service, /ALLOWED_CONTEXT_KEYS/);
  assert.match(service, /safeContext\(event\.context\)/);
  assert.match(service, /safeDiagnosticValue/);
  assert.match(service, /ON CONFLICT \(tenant_id, client_event_id\) DO NOTHING/);
  assert.match(service, /allowedDevices\.has\(deviceId\)/);
  assert.match(service, /MAX_INGEST_BATCH = 100/);
  assert.match(route, /authorizeAdminRoute\("support\.logs\.view"\)/);
  assert.match(route, /tenantId: auth\.tenantId/);
  assert.match(route, /rateLimit\(`support-events:\$\{auth\.tenantId\}:\$\{auth\.adminId\}`/);
  assert.doesNotMatch(route, /tenantId:\s*body/);
});

test("export and send are separately authorised, audited and consent gated", async () => {
  const service = code(await read("apps/web/lib/bms/supportDiagnostics.ts"));
  const exportRoute = code(await read("apps/web/app/api/bms/support-diagnostics/export/route.ts"));
  const sendRoute = code(await read("apps/web/app/api/bms/support-diagnostics/send/route.ts"));
  assert.match(exportRoute, /authorizeAdminRoute\("support\.logs\.export"\)/);
  assert.match(sendRoute, /authorizeAdminRoute\("support\.logs\.send"\)/);
  assert.match(exportRoute, /rateLimit\(`support-export:/);
  assert.match(sendRoute, /rateLimit\(`support-send:/);
  assert.match(sendRoute, /confirmed !== true/);
  assert.match(service, /'support\.logs_export'/);
  assert.match(service, /'support\.logs_send'/);
  assert.match(service, /persistBuffer\([^;]*"private"/s);
  assert.match(service, /'diagnostics'/);
  assert.match(service, /consent: true/);
  assert.match(service, /truncated/);
  assert.match(service, /sendEmail/);
  assert.match(service, /supportDiagnostics:send/);
  assert.match(service, /ORDER BY occurred_at DESC, id DESC LIMIT/);
  assert.match(service, /slice\(0, MAX_EVENTS_PER_SOURCE\)\.reverse\(\)/);
  assert.match(service, /new Date\(left\.at\)\.getTime\(\) - new Date\(right\.at\)\.getTime\(\)/);
});

test("platform support download is private, expires and is audited", async () => {
  const route = code(await read("apps/web/app/api/bms/support-diagnostics/bundles/[id]/download/route.ts"));
  const service = code(await read("apps/web/lib/bms/supportDiagnostics.ts"));
  assert.match(route, /authorizePlatformAdminRoute\(\)/);
  assert.match(route, /SELECT tenant_id FROM support_tickets/);
  assert.match(route, /private, no-store/);
  assert.match(service, /b\.expires_at > now\(\)/);
  assert.match(service, /'support\.logs_download'/);
});

test("legacy fleet logs are no longer an unauthenticated read surface", async () => {
  const list = code(await read("apps/web/app/api/logs/route.ts"));
  const detail = code(await read("apps/web/app/api/logs/[id]/route.ts"));
  const categories = code(await read("apps/web/app/api/admin/log-categories/route.ts"));
  const writer = code(await read("apps/web/lib/log/writeLog.server.ts"));
  assert.match(list, /authorizePlatformAdminRoute\(\)/);
  assert.match(detail, /authorizePlatformAdminRoute\(\)/);
  assert.match(categories, /authorizePlatformAdminRoute\(\)/);
  assert.match(list, /rateLimit\(`client-logs:/);
  assert.match(list, /tenantId,/);
  assert.match(writer, /SENSITIVE_KEY/);
  assert.match(writer, /SENSITIVE_TEXT/);
});

test("browser queue is scoped, idempotent and standalone POS can export/send", async () => {
  const activity = code(await read("apps/web/lib/supportActivity.ts"));
  const restaurant = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  const posRoute = code(await read("apps/web/app/api/pos/support-diagnostics/route.ts"));
  assert.match(activity, /storageKey\(scopeKey\)/);
  assert.match(activity, /eventId: eventId\(\)/);
  assert.match(activity, /sentIds\.has\(event\.eventId\)/);
  assert.match(posRoute, /authenticatePosDevice/);
  assert.match(posRoute, /verifyCashierPin/);
  assert.match(posRoute, /cashierHasPermission/);
  assert.match(posRoute, /body\?\.confirmed !== true/);
  assert.match(restaurant, /'restaurant\.item_add'/);
  assert.match(restaurant, /'restaurant\.item_remove'/);
});

test("route errors are tenant-attributed without mixing throttle windows across shops", async () => {
  const routeError = code(await read("apps/web/lib/log/routeError.ts"));
  assert.match(routeError, /resolveErrorTenant/);
  assert.match(routeError, /authenticatePosDevice/);
  assert.match(routeError, /sourceKey/);
  assert.match(routeError, /tenantId,/);
});
