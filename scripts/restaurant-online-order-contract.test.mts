import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { normalizeRestaurantOrderHours, restaurantOrderingState } from "../apps/web/lib/bms/restaurantOrdering";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("structured restaurant hours validate, sort, and support overnight windows", () => {
  assert.deepEqual(normalizeRestaurantOrderHours([
    { day: 2, open: "18:00", close: "02:00" },
    { day: 1, open: "09:00", close: "17:00" },
  ]), [
    { day: 1, open: "09:00", close: "17:00" },
    { day: 2, open: "18:00", close: "02:00" },
  ]);
  assert.throws(() => normalizeRestaurantOrderHours([{ day: 7, open: "09:00", close: "17:00" }]));
  assert.deepEqual(restaurantOrderingState({
    paused: false,
    hours: [{ day: 2, open: "18:00", close: "02:00" }],
    timezone: "UTC",
    now: new Date("2026-09-02T01:00:00Z"),
  }), { accepting: true, reason: null });
  assert.deepEqual(restaurantOrderingState({ paused: true, hours: [] }), { accepting: false, reason: "PAUSED" });
});

test("restaurant online orders require explicit branch context and a human acceptance", () => {
  const orders = read("apps/web/lib/bms/orders.ts");
  const service = read("apps/web/lib/bms/restaurantOrdering.ts");
  const route = read("apps/web/app/api/pos/restaurant/incoming/route.ts");
  assert.match(orders, /LOCATION_REQUIRED/);
  assert.match(orders, /restaurantOnlineOrder/);
  assert.match(orders, /FULFILLMENT_REQUIRED/);
  assert.match(orders, /fulfillment_type/);
  assert.match(orders, /updated\.rows\[0\]\.fulfillment_type !== null[\s\S]{0,160}enqueueKitchenTicketsInTx/);
  assert.doesNotMatch(orders, /confirmPayment[\s\S]{0,500}enqueueKitchenTicketsInTx/);
  assert.match(service, /status !== "PAID"/);
  assert.match(service, /enqueueKitchenTicketsInTx\(client, input\.tenantId, input\.orderId\)/);
  assert.match(service, /restaurant\.online_order_accept/);
  assert.match(route, /restaurant\.kitchen\.update/);
  assert.match(route, /auth\.device\.locationId/);
});

test("restaurant-only branch rules and tools do not leak into cafes or ordinary online shops", () => {
  const orders = read("apps/web/lib/bms/orders.ts");
  const pipeline = read("apps/web/lib/bms/pipeline.ts");
  const tools = read("apps/web/lib/bms/tools/catalog.ts");
  assert.match(orders, /const restaurantOnlineOrder = ordering\?\.isRestaurant === true/);
  assert.match(orders, /if \(restaurantOnlineOrder\)[\s\S]{0,2500}LOCATION_REQUIRED/);
  assert.match(orders, /ข้อมูลรับเอง\/จัดส่งแบบครัวใช้ได้เฉพาะร้านอาหารออนไลน์/);
  assert.match(pipeline, /profile\.businessArchetype === "restaurant"[\s\S]{0,300}list_restaurant_order_locations/);
  assert.match(tools, /tool\.name !== "list_restaurant_order_locations"[\s\S]{0,120}businessArchetype === "restaurant"/);
});

test("AI stock checks can follow the exact branch selected for a restaurant order", () => {
  const stock = read("apps/web/lib/bms/stock.ts");
  const products = read("apps/web/lib/bms/products.ts");
  const tools = read("apps/web/lib/bms/tools/catalog.ts");
  assert.match(stock, /requestedLocationId\?: string \| null/);
  assert.match(stock, /i\.location_id = \$3/);
  assert.match(stock, /location_id = \$4 AND product_sku/);
  // Both AI paths pass the chosen branch through checkStockForBranch(), which turns an invented
  // branch id into a ToolArgError the model can act on instead of an ai.tool_failed incident.
  assert.match(tools, /checkStockForBranch\(ec\.tenantId, product, size, locationId\)/);
  assert.match(tools, /checkStockForBranch\(ec\.tenantId, it\.sku, it\.size, requestedLocationId\)/);
  assert.match(tools, /INVALID_OR_INACTIVE_LOCATION[\s\S]{0,240}new ToolArgError/);
  assert.match(stock, /findAlternativeProducts\(tenantId, \{ sku: product\.sku, size, locationId/);
  assert.match(products, /locationId: input\.locationId/);
  assert.match(tools, /findAlternativeProducts\(ec\.tenantId, \{ sku, keyword, category, size, locationId, limit \}\)/);
});

test("menu serving options come from the catalog, not from branch stock rows", () => {
  // 9.51 makes bms_product_variants the truth for serving options and syncs inventory/pack/recipe
  // writes INTO it, never the reverse: "A recipe menu may have a variant while its own inventory
  // remains zero." upsertProduct() writes the variant and no bms_inventory row, so reading
  // inventory here answered "no sizes" for every menu a restaurant had just typed in — and
  // create_order requires a size, so the model had no way forward. It only appeared to work on
  // seeded demo data and on catalogs 9.51 back-filled, i.e. never in QA and always in production.
  const stock = read("apps/web/lib/bms/stock.ts");
  // Slice forward from the branch: "MENU_SIZE_REQUIRED" also appears in the StockResult union
  // near the top of the file, so indexOf() from the start would produce an empty slice.
  const branchStart = stock.indexOf('if (policy === "NON_STOCK" || policy === "RECIPE")');
  assert.ok(branchStart > 0, "menu policy branch not found");
  const rest = stock.slice(branchStart);
  const menuBranch = rest.slice(0, rest.indexOf('status: "MENU_SIZE_REQUIRED"'));
  assert.ok(menuBranch.length > 0, "menu size lookup not found");
  assert.match(menuBranch, /FROM bms_product_variants variant/);
  assert.match(menuBranch, /variant\.active/);
  assert.doesNotMatch(menuBranch, /FROM bms_inventory/);
  // The same catalog truth already backs the restaurant menu grid.
  assert.match(read("apps/web/lib/bms/restaurantPos.ts"), /FROM bms_product_variants variant/);
});

test("incoming orders are visible on POS and mirrored in admin", () => {
  const pos = read("apps/web/app/(pos)/pos/page.tsx");
  const admin = read("apps/web/app/(admin)/admin/orders/page.tsx");
  assert.match(pos, /key: "incoming"/);
  assert.match(pos, /\/api\/pos\/restaurant\/incoming/);
  assert.match(pos, /รับออร์เดอร์/);
  // Tolerate line wrapping: the guarantee is that the incoming tab is gated on the archetype,
  // not that the ternary fits on one line.
  assert.match(pos, /businessArchetype === "restaurant"\s*\?\s*POS_TABS/);
  assert.match(admin, /fulfillmentType/);
  assert.match(admin, /btn_accept/);
});

test("an incoming order card shows what is still live, in the unit cancel_lines expects", () => {
  // Two failures in one field: a cancelled dish stayed on the card (kitchen ticket cancelled,
  // money already queued for refund, counter still told to cook it), and the card handed the
  // cancel action oi.qty (base units) while the return engine reads packQty as a pack count —
  // so cancelling any pack-sold line answered RETURN_QTY_EXCEEDED.
  const service = read("apps/web/lib/bms/restaurantOrdering.ts");
  const incoming = service.slice(service.indexOf("export async function listIncomingRestaurantOrders"));
  assert.match(incoming, /COALESCE\(oi\.pack_qty, oi\.qty\)/);
  assert.match(incoming, /FROM bms_pos_return_items pri/);
  assert.match(incoming, /remaining\.pack_qty > 0/);
  assert.doesNotMatch(incoming, /'qty', oi\.qty/);
  assert.match(read("apps/web/app/(pos)/pos/page.tsx"), /packQty: item\.qty/);
});
