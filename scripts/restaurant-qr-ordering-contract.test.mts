import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");
const code = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "")
  .replace(/^[ \t]*--.*$/gm, "");

test("a printed QR is a rotatable table locator, not kitchen authority", async () => {
  const migration = code(await read("db/migrations/9.60__bms_restaurant_qr_ordering.sql"));
  const service = code(await read("apps/web/lib/bms/restaurantQrOrdering.ts"));
  const publicRoute = code(await read("apps/web/app/api/bms/restaurant-qr/[token]/route.ts"));

  assert.match(migration, /UNIQUE \(public_token\)/);
  assert.match(migration, /public_token_hash TEXT NOT NULL/);
  assert.match(migration, /uq_bms_restaurant_table_qr_active/);
  assert.match(service, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(service, /WHERE qr\.public_token_hash = \$1/);
  assert.match(service, /restaurant\.table_qr\.rotate/);
  assert.match(publicRoute, /httpOnly: true/);
  assert.match(publicRoute, /sameSite: "lax"/);
  assert.doesNotMatch(publicRoute, /sendRestaurantKitchenRound/);
});

test("scanner session is bound to one OPEN check and dies with that check", async () => {
  const migration = code(await read("db/migrations/9.60__bms_restaurant_qr_ordering.sql"));
  const service = code(await read("apps/web/lib/bms/restaurantQrOrdering.ts"));

  assert.match(migration, /FOREIGN KEY \(tenant_id, location_id, check_id\)/);
  assert.match(migration, /bms_expire_restaurant_qr_on_check_close/);
  assert.match(migration, /OLD\.status = 'OPEN' AND NEW\.status <> 'OPEN'/);
  assert.match(migration, /SET revoked_at = COALESCE\(revoked_at, now\(\)\)/);
  assert.match(migration, /SET status = 'EXPIRED'/);
  assert.match(service, /status = 'OPEN'/);
  assert.match(service, /ORDER BY opened_at DESC LIMIT 1\s+FOR UPDATE/);
  assert.match(service, /session_token_hash = \$1/);
  assert.match(service, /qr\.public_token_hash = \$2/);
  assert.match(service, /createHash\("sha256"\)/);
  assert.doesNotMatch(service, /JOIN bms_restaurant_checks check\s/);
});

test("public ordering is bounded, structured, idempotent, and only creates PENDING proposals", async () => {
  const migration = code(await read("db/migrations/9.60__bms_restaurant_qr_ordering.sql"));
  const service = code(await read("apps/web/lib/bms/restaurantQrOrdering.ts"));
  const helpers = code(await read("apps/web/app/api/bms/restaurant-qr/routeHelpers.ts"));
  const route = code(await read("apps/web/app/api/bms/restaurant-qr/submissions/route.ts"));

  assert.match(migration, /status\s+TEXT NOT NULL DEFAULT 'PENDING'/);
  assert.match(migration, /UNIQUE \(tenant_id, session_id, idempotency_key\)/);
  assert.match(service, /MAX_SUBMISSION_ITEMS = 30/);
  assert.match(service, /ON CONFLICT \(tenant_id, session_id, idempotency_key\) DO NOTHING/);
  assert.match(service, /available: Number\(variant\.available\) > 0/);
  assert.doesNotMatch(service.slice(
    service.indexOf("export async function getRestaurantQrMenu"),
    service.indexOf("export async function getRestaurantQrMenuItem")
  ), /kitchenStationId|availableTotal|unavailableResetsAt/);
  assert.match(service, /resolveRestaurantCheckItemRequest/);
  assert.equal((service.match(/modifier\.size = item\.size/g) ?? []).length, 2);
  assert.doesNotMatch(service, /return \{ session, items \}/);
  assert.doesNotMatch(service, /return \{\s*session,\s*submissions/);
  assert.match(helpers, /rateLimit\(`restaurant-qr:/);
  assert.match(helpers, /scope !== "open"[\s\S]{0,300}createHash\("sha256"\)/);
  assert.match(helpers, /x-bms-restaurant-qr/);
  assert.match(route, /"submit", 10/);
  assert.doesNotMatch(route, /tenantId\s*:\s*body/);
  assert.doesNotMatch(route, /tableId\s*:\s*body/);
  assert.doesNotMatch(route, /checkId\s*:\s*body/);
});

test("moving a check preserves scan snapshots while the inbox shows the current table", async () => {
  const ordering = code(await read("apps/web/lib/bms/restaurantQrOrdering.ts"));
  const restaurant = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  const move = restaurant.slice(
    restaurant.indexOf("export async function moveRestaurantCheck"),
    restaurant.indexOf("export async function cancelRestaurantCheck")
  );

  assert.match(ordering, /JOIN bms_restaurant_checks check_row[\s\S]{0,260}table_row\.id = check_row\.table_id/);
  assert.doesNotMatch(move, /UPDATE bms_restaurant_qr_submissions/);
});

test("staff acceptance requires device, PIN, open shift and pos.sell", async () => {
  const route = code(await read("apps/web/app/api/pos/restaurant/qr-orders/route.ts"));
  const auth = code(await read("apps/web/app/api/pos/restaurant/routeAuth.ts"));
  const service = code(await read("apps/web/lib/bms/restaurantPos.ts"));

  assert.match(route, /authenticateRestaurantMutation\(req, body, "pos\.sell"\)/);
  assert.match(auth, /authenticatePosDevice/);
  assert.match(auth, /verifyCashierPin/);
  assert.match(auth, /getOpenPosShift/);
  assert.match(service, /device_id = \$3 AND location_id = \$4[\s\S]{0,80}status = 'OPEN'/);
  assert.match(route, /locationId: auth\.device\.locationId/);
  assert.doesNotMatch(route, /tenantId\s*:\s*body/);
  assert.doesNotMatch(route, /locationId\s*:\s*body/);
  assert.doesNotMatch(route, /checkId\s*:\s*body/);
});

test("accepting a QR proposal and sending its kitchen round is one transaction", async () => {
  const service = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  const accept = service.slice(service.indexOf("export async function acceptRestaurantQrSubmission"));

  assert.match(accept, /beginTenantTx\(client, input\.tenantId/);
  assert.match(accept, /status = 'PENDING'/);
  assert.match(accept, /status = 'NEW'/);
  assert.match(accept, /const roundInput: KitchenRoundInput = \{ \.\.\.input, checkId \}/);
  assert.match(accept, /sendRestaurantKitchenRoundInTx\(client, roundInput\)/);
  assert.match(accept, /status = 'ACCEPTED'/);
  assert.match(accept, /restaurant\.qr_submission\.accept/);
  assert.match(accept, /client\.query\("COMMIT"\)/);
  assert.match(accept, /client\.query\("ROLLBACK"\)/);
  assert.match(accept, /มีรายการที่พนักงานยังไม่ส่งครัว/);
});

test("QR admin controls use floor permission and the public page skips admin session chrome", async () => {
  const resolver = code(await read("apps/web/graphql/bmsRestaurantFloorAdmin.ts"));
  const providers = code(await read("apps/web/app/ClientProviders.tsx"));
  const page = code(await read("apps/web/app/(qr)/q/[token]/page.tsx"));
  const adminPage = code(await read("apps/web/app/(admin)/admin/restaurant-floor/page.tsx"));

  assert.match(resolver, /requirePermission\(ctx, "restaurant\.floor\.manage"\)/);
  assert.match(resolver, /issueRestaurantTableQr/);
  assert.match(providers, /pathname\.startsWith\("\/q\/"\)/);
  assert.match(page, /\/api\/bms\/restaurant-qr\/\$\{encodeURIComponent\(token\)\}/);
  assert.match(page, /\/api\/bms\/restaurant-qr\/submissions/);
  assert.match(page, /headers\.set\("x-bms-restaurant-qr", tableToken\)/);
  assert.doesNotMatch(adminPage, /document\.write/);
});
