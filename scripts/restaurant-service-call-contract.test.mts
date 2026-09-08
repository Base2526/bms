import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");
const code = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "")
  .replace(/^[ \t]*--.*$/gm, "");

test("service calls are tenant-bound QR work, never fake order lines", async () => {
  const migration = code(await read("db/migrations/9.69__bms_restaurant_service_calls.sql"));
  const service = code(await read("apps/web/lib/bms/restaurantServiceCalls.ts"));
  assert.match(migration, /FOREIGN KEY \(tenant_id, location_id, table_id, check_id, session_id\)/);
  assert.match(migration, /WHERE status = 'PENDING'/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON bms_restaurant_service_calls TO bms_app/);
  assert.match(service, /requireRestaurantQrSession/);
  assert.match(service, /beginTenantTx\(client, session\.tenantId\)/);
  assert.doesNotMatch(service, /bms_restaurant_qr_submission_items/);
  assert.doesNotMatch(service, /bms_restaurant_check_items/);
  assert.doesNotMatch(service, /sendRestaurantKitchenRound/);
});

test("public calls are bounded, idempotent and cannot repeat before acknowledgement", async () => {
  const migration = code(await read("db/migrations/9.69__bms_restaurant_service_calls.sql"));
  const service = code(await read("apps/web/lib/bms/restaurantServiceCalls.ts"));
  const route = code(await read("apps/web/app/api/bms/restaurant-qr/service-calls/route.ts"));
  assert.match(migration, /UNIQUE \(tenant_id, session_id, idempotency_key\)/);
  assert.match(migration, /uq_bms_restaurant_service_calls_pending_check/);
  assert.match(service, /check_id = \$2 AND status = 'PENDING'/);
  assert.match(service, /WHERE tenant_id = \$1 AND check_id = \$2[\s\S]{0,100}created_at > now\(\) - interval '24 hours'/,
    "ทุกเครื่องที่โต๊ะเดียวกันต้องเห็นว่าโต๊ะเรียกแล้ว ไม่ใช่รู้เฉพาะ session ที่กด");
  assert.match(service, /ON CONFLICT \(tenant_id, session_id, idempotency_key\) DO NOTHING/);
  assert.match(service, /request\.code, request\.note, idempotencyKey/);
  assert.match(route, /"service-call-submit", 6/);
  assert.doesNotMatch(route, /tenantId\s*:\s*body/);
  assert.doesNotMatch(route, /locationId\s*:\s*body/);
  assert.doesNotMatch(route, /tableId\s*:\s*body/);
  assert.doesNotMatch(route, /checkId\s*:\s*body/);
});

test("staff lifecycle requires device, PIN, open shift and pos.sell", async () => {
  const route = code(await read("apps/web/app/api/pos/restaurant/service-calls/route.ts"));
  const service = code(await read("apps/web/lib/bms/restaurantServiceCalls.ts"));
  assert.match(route, /authenticateRestaurantRead/);
  assert.match(route, /authenticateRestaurantMutation\(req, body, "pos\.sell"\)/);
  assert.match(route, /locationId: auth\.device\.locationId/);
  assert.match(service, /"ACKNOWLEDGED" : "COMPLETED"/);
  assert.match(service, /restaurant\.service_call\.\$\{input\.action\}/);
  assert.match(service, /bms_audit_log/);
});

test("terminal check closure expires service calls but CLOSING remains reversible", async () => {
  const migration = code(await read("db/migrations/9.69__bms_restaurant_service_calls.sql"));
  assert.match(migration, /NEW\.status IN \('PAID', 'CANCELLED', 'MERGED'\)/);
  assert.match(migration, /bms_restaurant_service_calls[\s\S]{0,180}status IN \('PENDING', 'ACKNOWLEDGED'\)/);
  assert.doesNotMatch(migration, /NEW\.status <> 'OPEN'/);
});

test("both guest and staff surfaces keep the call visible from every screen", async () => {
  const guest = code(await read("apps/web/app/(qr)/q/[token]/page.tsx"));
  const staff = code(await read("apps/web/app/(pos)/pos/restaurant/page.tsx"));
  assert.match(guest, /className=\{styles\.callStaffButton\}/);
  assert.match(guest, /disabled=\{Boolean\(pendingServiceCall\)\}/);
  assert.match(guest, /serviceCode === "OTHER" && serviceNote\.trim\(\)\.length < 3/);
  assert.match(staff, /key: "CALLS"/);
  assert.match(staff, /badge: pendingServiceCalls\.length/);
  assert.match(staff, /focused: screen === "CALLS"/);
});
