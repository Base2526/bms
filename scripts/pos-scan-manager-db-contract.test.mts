import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("9.6 migration is idempotent and gives new tenant data RLS + grants", async () => {
  const sql = await read("db/migrations/9.6__bms_pos_scan_manager_and_purchase_receipts.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS scanner_mode/i);
  assert.match(sql, /scanner_prefix_key ~ '\^F\(\[1-9\]\|1\[0-9\]\|2\[0-4\]\)\$'/i);
  assert.match(sql, /scanner_suffix_key IN \('Enter', 'Tab'\)/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS bms_pos_purchase_receipts/i);
  assert.doesNotMatch(sql, /device_id\s+UUID[^\n]+ON DELETE CASCADE/i);
  assert.match(sql, /UNIQUE \(tenant_id, device_id, idempotency_key\)/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/i);
  assert.match(sql, /CREATE POLICY bms_pos_purchase_receipts_tenant_isolation/i);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON bms_pos_purchase_receipts TO bms_app/i);
});

test("POS purchase adapter derives tenant/location from device and rechecks PIN + permission", async () => {
  const route = await read("apps/web/app/api/pos/purchase/route.ts");
  assert.match(route, /authenticatePosDevice/);
  assert.match(route, /verifyCashierPin\(device\.tenantId/);
  assert.match(route, /cashierHasPermission\(device\.tenantId, auth\.userId, "purchase\.receive"\)/);
  assert.match(route, /locationId: device\.locationId/);
  assert.match(route, /receivePurchaseOrder\(/);
  assert.match(route, /UUID_RE\.test\(poId\)/);
  assert.match(route, /isIsoDate\(raw\.expiryDate\)/);
  assert.doesNotMatch(route, /DEFAULT_TENANT_ID/);
});

test("legacy device upserts preserve scanner configuration when fields are omitted", async () => {
  const service = await read("apps/web/lib/bms/pos.ts");
  assert.match(service, /scanner_mode = COALESCE\(\$8, bms_pos_devices\.scanner_mode\)/);
  assert.match(service, /scanner_prefix_key = COALESCE\(\$9, bms_pos_devices\.scanner_prefix_key\)/);
  assert.match(service, /prefix ของ Scanner ต้องเป็นปุ่ม F1–F24/);
});

test("POS session keeps purchase receivers separate from pos.sell cashiers", async () => {
  const service = await read("apps/web/lib/bms/pos.ts");
  const session = await read("apps/web/app/api/pos/session/route.ts");
  assert.match(service, /listPosPurchaseReceivers/);
  assert.match(service, /rp\.permission = 'purchase\.receive'/);
  assert.match(session, /purchaseReceivers/);
});

test("purchase receipt keeps location, movement, audit and retry result in one transaction", async () => {
  const service = await read("apps/web/lib/bms/purchase.ts");
  assert.match(service, /beginTenantTx\(client, tenantId/);
  assert.match(service, /INSERT INTO bms_pos_purchase_receipts/);
  assert.match(service, /ON CONFLICT \(tenant_id, device_id, idempotency_key\) DO NOTHING/);
  assert.match(service, /locationId,\s*sku: ln\.sku/s);
  assert.match(service, /INSERT INTO bms_audit_log/);
  assert.match(service, /UPDATE bms_pos_purchase_receipts SET result/);
  assert.match(service, /actorUserId: options\.idempotency\.actorUserId\.toLowerCase\(\)/);
  assert.match(service, /unitCost: Number\(unit_cost\)/);
  assert.doesNotMatch(service, /unitCost: ln\.unitCost/);
  assert.match(service, /const auditActor = String\(options\.audit\?\.actor \?\? actor/);
  const auditAt = service.indexOf("INSERT INTO bms_audit_log");
  const commitAt = service.indexOf('client.query("COMMIT")', auditAt);
  assert.ok(auditAt >= 0 && commitAt > auditAt, "purchase.receive audit must be written before COMMIT");
});

test("admin receive also opts into the in-transaction purchase audit", async () => {
  const resolver = await read("apps/web/graphql/bmsPurchase.ts");
  assert.match(resolver, /audit:\s*\{[\s\S]*action: "purchase\.receive"/);
  assert.doesNotMatch(resolver, /await audit\(ctx, "purchase\.receive"/);
});

test("AI purchase receive relies on the service transaction instead of a duplicate post-commit audit", async () => {
  const catalog = await read("apps/web/lib/bms/tools/catalog.ts");
  const start = catalog.indexOf("const receivePurchaseOrderTool");
  const end = catalog.indexOf("const upsertCustomerTool", start);
  const block = catalog.slice(start, end);
  assert.match(block, /receivePurchaseOrder\([\s\S]*ec\.ctx\?\.admin\?\.id \?\? null,[\s\S]*surface: `ai:\$\{ec\.surface\}`/);
  assert.doesNotMatch(block, /auditWrite\(/);
});
