import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { kioskQuoteChanged, normalizeKioskRequestCode } from "../apps/web/lib/bms/restaurantKioskReview.ts";
import { KIOSK_BODY_MAX_BYTES, readRestaurantKioskJson } from "../apps/web/lib/bms/restaurantKioskRequestBody.ts";
import { restaurantMenuStartingPrice } from "../apps/web/lib/bms/restaurantMenuStartingPrice.ts";
import { checkRestaurantKioskRateLimit } from "../apps/web/lib/bms/restaurantKioskEdge.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "").replace(/^[ \t]*--.*$/gm, "");

test("kiosk schema is branch-bound, tenant-isolated and idempotent", async () => {
  const migration = code(await read("db/migrations/10.144__bms_restaurant_kiosk_ordering.sql"));
  const hardened = code(await read("db/migrations/10.145__bms_restaurant_kiosk_rls_scope.sql"));
  assert.match(migration, /UNIQUE \(token_hash\)/);
  assert.match(migration, /uq_bms_restaurant_kiosks_active_branch/);
  assert.match(migration, /UNIQUE \(tenant_id, kiosk_id, idempotency_key\)/);
  assert.match(migration, /FOREIGN KEY \(tenant_id, location_id\)/);
  assert.match(migration, /UNIQUE \(tenant_id, location_id, id\)/);
  assert.match(migration, /FOREIGN KEY \(tenant_id, location_id, kiosk_id\)/);
  assert.match(migration, /FOREIGN KEY \(tenant_id, location_id, check_id\)/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON bms_restaurant_kiosks, bms_restaurant_kiosk_submissions TO bms_app/);
  assert.match(hardened, /bms\.kiosk_token_hash/);
  assert.match(hardened, /bms_restaurant_kiosk_submissions_tenant_isolation/);
  assert.doesNotMatch(hardened, /COALESCE\(NULLIF\(current_setting\('bms\.tenant_id'/);
});

test("public kiosk can only read the restaurant menu and create bounded proposals", async () => {
  const service = code(await read("apps/web/lib/bms/restaurantKiosk.ts"));
  const restaurantMenu = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  const route = code(await read("apps/web/app/api/bms/restaurant-kiosk/[token]/route.ts"));
  assert.match(service, /kiosk\.token_hash = \$1 AND kiosk\.active/);
  assert.match(service, /business_archetype !== "restaurant"/);
  assert.match(service, /surface: "RESTAURANT_POS"/);
  assert.match(restaurantMenu, /SELECT p\.sku, p\.name, p\.category, p\.price/);
  assert.match(service, /category: item\.category/);
  assert.match(service, /normalizeSubmissionItems\(input\.items\)/);
  assert.match(service, /quoteRestaurantKioskItems\(kiosk\.tenantId, kiosk\.locationId, items\)/);
  assert.match(service, /status = 'PENDING' AND submitted_at <= now\(\) - interval '30 minutes'/);
  assert.match(service, /status = 'PENDING'\s+AND submitted_at > now\(\) - interval '30 minutes'/);
  assert.match(service, /ON CONFLICT \(tenant_id, kiosk_id, idempotency_key\) DO NOTHING/);
  assert.match(service, /beginTenantTx\(client, kiosk\.tenantId\)/);
  assert.match(route, /checkRestaurantKioskRateLimit\(token, action, ceiling\)/);
  assert.match(route, /readRestaurantKioskJson\(req\)/);
  assert.match(route, /publicErrorMessage\(/);
  assert.doesNotMatch(route, /tenantId:\s*body|locationId:\s*body|checkId:\s*body/);
  assert.doesNotMatch(route, /recordPosSale|sendRestaurantKitchenRound|openRestaurantCheck/);
});

test("public kiosk body parser rejects oversized, malformed and invalid UTF-8 bodies", async () => {
  for (const file of ["apps/web/Caddyfile.server", "apps/web/Caddyfile.local"]) {
    const ingress = await read(file);
    assert.match(ingress, /@restaurantKiosk path \/api\/bms\/restaurant-kiosk\/\*/);
    assert.match(ingress, /\/api\/bms\/restaurant-kiosk-device(?:s)?/);
    assert.match(ingress, /request_body @restaurantKiosk \{\s*max_size 32KB\s*\}/);
  }
  const encode = (text: string) => new TextEncoder().encode(text);
  const request = (chunks: Uint8Array[], headers: Record<string, string> = {}) => new Request("http://localhost/kiosk", {
    method: "POST", headers, duplex: "half",
    body: new ReadableStream<Uint8Array>({ start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    } }),
  } as RequestInit);
  assert.deepEqual(await readRestaurantKioskJson(request([encode('{"action":"submit"}')])), { action: "submit" });
  await assert.rejects(() => readRestaurantKioskJson(request([encode("x".repeat(KIOSK_BODY_MAX_BYTES + 1))])), /BODY_TOO_LARGE/);
  await assert.rejects(() => readRestaurantKioskJson(request([encode("x".repeat(KIOSK_BODY_MAX_BYTES + 1))], { "content-length": "2" })), /BODY_TOO_LARGE/);
  await assert.rejects(() => readRestaurantKioskJson(request([encode("{}")], { "content-length": String(KIOSK_BODY_MAX_BYTES + 1) })), /BODY_TOO_LARGE/);
  await assert.rejects(() => readRestaurantKioskJson(request([encode("[]")])), /INVALID_JSON/);
  await assert.rejects(() => readRestaurantKioskJson(request([new Uint8Array([0xff])])), /INVALID_JSON/);
});

test("staff review enforces PIN, permission and one check/kitchen transaction", async () => {
  const route = code(await read("apps/web/app/api/pos/restaurant/kiosk/route.ts"));
  const service = code(await read("apps/web/lib/bms/restaurantPos.ts"));
  const accept = service.slice(service.indexOf("export async function acceptRestaurantKioskSubmission"),
    service.indexOf("export async function moveRestaurantCheck"));
  assert.match(route, /authenticateRestaurantMutation\(req, body,/);
  assert.match(route, /"restaurant\.floor\.manage" : "pos\.sell"/);
  assert.match(route, /deviceId: auth\.device\.id, shiftId: auth\.shift\.id/);
  assert.match(accept, /beginTenantTx\(client, input\.tenantId/);
  assert.match(accept, /service_mode = 'DINE_IN' AND status = 'OPEN'/);
  assert.match(accept, /openRestaurantCheckInTx\(client/);
  assert.match(accept, /sendRestaurantKitchenRoundInTx\(client/);
  assert.match(accept, /quote\.fingerprint !== input\.quoteFingerprint/);
  assert.match(accept, /selected\.table_id !== input\.expectedTableId/);
  assert.match(accept, /restaurant\.kiosk\.accept/);
  assert.match(accept, /client\.query\("ROLLBACK"\)/);
  assert.doesNotMatch(accept, /recordPosSale\(/);
});

test("price evidence survives JSONB key reordering and catches changes", () => {
  const current = { lines: [{ sku: "FOOD", productName: "Rice", size: "L", packCode: "BASE", packQty: 2,
    basePrice: 80, unitPrice: 90, lineAmount: 180, modifierCatalogFingerprint: "catalog-v1",
    modifiers: [{ code: "EGG", name: "Egg", priceDelta: 10 }] }] };
  const jsonbOrder = JSON.parse('{"modifiers":[{"priceDelta":10,"name":"Egg","code":"EGG"}],"lineAmount":180,"unitPrice":90,"basePrice":80,"modifierCatalogFingerprint":"catalog-v1","sku":"FOOD","productName":"Rice","size":"L","packCode":"BASE","packQty":2}');
  assert.equal(kioskQuoteChanged([jsonbOrder], current), false);
  assert.equal(kioskQuoteChanged([{ ...jsonbOrder, lineAmount: 200 }], current), true);
  assert.equal(kioskQuoteChanged([{ ...jsonbOrder, modifiers: [{ code: "EGG", name: "Egg", priceDelta: 15 }] }], current), true);
  assert.equal(kioskQuoteChanged([{ ...jsonbOrder, modifierCatalogFingerprint: "catalog-v2" }], current), true);
  assert.equal(kioskQuoteChanged([{ ...jsonbOrder, modifiers: [{ code: "EGG", name: "New egg", priceDelta: 10 }] }], current), true);
  assert.equal(kioskQuoteChanged([{ ...jsonbOrder, productName: "New rice" }], current), true);
  assert.equal(kioskQuoteChanged([null], current), true);
});

test("starting menu price excludes an unavailable cheap size without hiding recipe sizes", () => {
  const variants = [{ size: "S", available: 0, price: 50 }, { size: "L", available: 4, price: 80 }];
  const direct = restaurantMenuStartingPrice({ variants, stockPolicy: "DIRECT", temporarilyUnavailable: false, fallbackPrice: 40 });
  assert.equal(direct.price, 80);
  assert.deepEqual(direct.choices.map((size) => size.sellable), [false, true]);
  const recipe = restaurantMenuStartingPrice({ variants, stockPolicy: "RECIPE", temporarilyUnavailable: false, fallbackPrice: 40 });
  assert.equal(recipe.price, 50);
  assert.deepEqual(recipe.choices.map((size) => size.sellable), [true, true]);
  const soldOut = restaurantMenuStartingPrice({ variants, stockPolicy: "RECIPE", temporarilyUnavailable: true, fallbackPrice: 40 });
  assert.deepEqual(soldOut.choices.map((size) => size.sellable), [false, false]);
  assert.equal(restaurantMenuStartingPrice({ variants: [variants[1]], stockPolicy: "DIRECT", temporarilyUnavailable: false, fallbackPrice: 40 }).price, 80);
});

test("kiosk admission is fleet-wide, ignores spoofable forwarded IP and fails closed", async () => {
  const keys: string[] = [];
  const allow = async (key: string, limit: number) => {
    keys.push(`${key}:${limit}`);
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  };
  assert.deepEqual(await checkRestaurantKioskRateLimit("token", "submit", 10, allow), { status: 200, retryAfter: 0 });
  assert.equal(keys.length, 2);
  assert.match(keys[0], /:fleet:1200$/);
  assert.match(keys[1], /:token:[0-9a-f]{64}:10$/);
  assert.ok(keys.every((key) => !key.includes("x-forwarded-for") && !key.includes("198.51.100.1")));
  assert.deepEqual(await checkRestaurantKioskRateLimit("token", "submit", 10, async () => null), { status: 503, retryAfter: 1 });
  assert.deepEqual(await checkRestaurantKioskRateLimit("token", "submit", 10, async () => { throw new Error("Redis down"); }), { status: 503, retryAfter: 1 });
  assert.deepEqual(await checkRestaurantKioskRateLimit("token", "submit", 10, async () => ({ ok: false, remaining: 0, retryAfter: 12 })), { status: 429, retryAfter: 12 });
});

test("request-code lookup accepts only a bounded UUID prefix or full id", () => {
  assert.equal(normalizeKioskRequestCode(" ABCDEF12 "), "abcdef12");
  assert.equal(normalizeKioskRequestCode(""), "");
  assert.throws(() => normalizeKioskRequestCode("123"));
  assert.throws(() => normalizeKioskRequestCode("abcdef12%"));
  assert.throws(() => normalizeKioskRequestCode("abcdef12' OR 1=1"));
});

test("rotation and disable expire unreviewed proposals without exposing the old token", async () => {
  const service = code(await read("apps/web/lib/bms/restaurantKiosk.ts"));
  const issue = service.slice(service.indexOf("export async function issueRestaurantKiosk"),
    service.indexOf("export async function restaurantKioskState"));
  assert.match(issue, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(issue, /SET status = 'EXPIRED'/);
  assert.match(issue, /restaurant\.kiosk\.disable/);
  assert.match(issue, /restaurant\.kiosk\.rotate/);
  assert.doesNotMatch(issue, /SELECT[^`]*token_hash[^`]*RETURNING token_hash/);
});

test("customer and operator surfaces expose both modes and clear shared-screen state", async () => {
  const page = code(await read("apps/web/app/(kiosk)/kiosk/[token]/page.tsx"));
  const pos = code(await read("apps/web/app/(pos)/pos/restaurant/page.tsx"));
  const providers = code(await read("apps/web/app/ClientProviders.tsx"));
  assert.match(page, /setMode\("TAKEAWAY"\)/);
  assert.match(page, /setMode\("DINE_IN"\)/);
  assert.match(page, /setTimeout\(reset, 120_000\)/);
  assert.match(page, /submitKey\.current \|\|= crypto\.randomUUID\(\)/);
  assert.match(pos, /screen === "KIOSK"/);
  assert.match(pos, /badge: pendingKioskSubmissions\.length/);
  assert.match(providers, /pathname\.startsWith\("\/kiosk\/"\)/);
});
