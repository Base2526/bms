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
  assert.match(orders, /fulfillment_type/);
  assert.doesNotMatch(orders, /confirmPayment[\s\S]{0,500}enqueueKitchenTicketsInTx/);
  assert.match(service, /status !== "PAID"/);
  assert.match(service, /enqueueKitchenTicketsInTx\(client, input\.tenantId, input\.orderId\)/);
  assert.match(service, /restaurant\.online_order_accept/);
  assert.match(route, /restaurant\.kitchen\.update/);
  assert.match(route, /auth\.device\.locationId/);
});

test("incoming orders are visible on POS and mirrored in admin", () => {
  const pos = read("apps/web/app/(pos)/pos/page.tsx");
  const admin = read("apps/web/app/(admin)/admin/orders/page.tsx");
  assert.match(pos, /key: "incoming"/);
  assert.match(pos, /\/api\/pos\/restaurant\/incoming/);
  assert.match(pos, /รับออร์เดอร์/);
  assert.match(admin, /fulfillmentType/);
  assert.match(admin, /btn_accept/);
});
