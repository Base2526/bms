import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mapRestaurantKioskTrace, mapRestaurantKioskTraceLine } from "../apps/web/lib/bms/restaurantKioskTraceView.ts";

const submittedAt = new Date("2026-11-27T01:00:00.000Z");
const row = {
  id: "11111111-1111-4111-8111-111111111111", service_mode: "TAKEAWAY" as const,
  status: "PENDING", item_count: 1, submitted_at: submittedAt, reviewed_at: null, reviewer_name: null,
  check_id: null, check_status: null, order_id: null, accepted_order_id: null,
  order_status: null, paid_at: null,
  payment_ids: null, receipt_id: null, receipt_no: null, receipt_type: null,
  table_code: null, table_name: null,
  area_name: null, split_group_no: null, queue_prefix: null, queue_no: null, queue_status: null,
  has_split_descendant: false,
};
const line = {
  submission_id: row.id, line_no: 1,
  check_item_id: "66666666-6666-4666-8666-666666666666",
  product_name: "Rice", pack_qty: 2, item_status: "SENT",
  current_check_id: "22222222-2222-4222-8222-222222222222",
  kitchen_status: "READY", check_status: "OPEN",
  order_id: "33333333-3333-4333-8333-333333333333",
  order_status: "PENDING", paid_at: null,
  order_item_id: "123", returned_qty: 0,
};

test("manager trace separates proposal, accepted check and paid sale", () => {
  const pending = mapRestaurantKioskTrace(row);
  assert.equal(pending.settlement, "NOT_APPLICABLE");
  assert.equal(pending.currentOrderId, null);
  assert.equal(pending.acceptedOrderId, null);
  assert.equal(pending.pickupNumber, null);

  const accepted = mapRestaurantKioskTrace({ ...row, status: "ACCEPTED",
    check_id: "22222222-2222-4222-8222-222222222222", check_status: "OPEN",
    order_id: "33333333-3333-4333-8333-333333333333",
    accepted_order_id: "33333333-3333-4333-8333-333333333333", order_status: "PENDING" }, null, [line]);
  assert.equal(accepted.settlement, "UNPAID");
  assert.equal(accepted.currentOrderId, "33333333-3333-4333-8333-333333333333");
  assert.equal(accepted.acceptedOrderId, accepted.currentOrderId);

  const laterRound = mapRestaurantKioskTrace({ ...row, status: "ACCEPTED",
    accepted_order_id: "33333333-3333-4333-8333-333333333333",
    order_id: "55555555-5555-4555-8555-555555555555", check_status: "OPEN",
    order_status: "PENDING" }, null, [line]);
  assert.equal(laterRound.acceptedOrderId, accepted.acceptedOrderId);
  assert.notEqual(laterRound.acceptedOrderId, laterRound.currentOrderId);

  const paid = mapRestaurantKioskTrace({ ...row, status: "ACCEPTED",
    check_status: "PAID", order_status: "COMPLETED", paid_at: submittedAt,
    payment_ids: ["44444444-4444-4444-8444-444444444444"],
    receipt_no: "RC-123", receipt_type: "ABBREVIATED",
    queue_prefix: "A", queue_no: 7, queue_status: "READY" }, "A007",
    [{ ...line, check_status: "PAID", order_status: "COMPLETED", paid_at: submittedAt }]);
  assert.equal(paid.settlement, "PAID");
  assert.deepEqual(paid.paymentIds, ["44444444-4444-4444-8444-444444444444"]);
  assert.equal(paid.receiptNo, "RC-123");
  assert.equal(paid.receiptType, "ABBREVIATED");
  assert.equal(mapRestaurantKioskTrace({ ...row, status: "ACCEPTED",
    check_status: "PAID", order_status: "COMPLETED", paid_at: submittedAt,
    receipt_no: "INV-123", receipt_type: "FULL" }, null,
    [{ ...line, check_status: "PAID", order_status: "COMPLETED", paid_at: submittedAt }]).receiptType, "FULL");
  assert.equal(paid.pickupNumber, "A007");
  assert.equal(paid.pickupStatus, "READY");
  const split = mapRestaurantKioskTrace({ ...row, status: "ACCEPTED",
    check_status: "PAID", order_status: "COMPLETED", paid_at: submittedAt,
    has_split_descendant: true }, null,
    [{ ...line, current_check_id: "77777777-7777-4777-8777-777777777777",
      check_status: "PAID", order_status: "COMPLETED", paid_at: submittedAt }]);
  assert.equal(split.settlement, "PAID");
  assert.equal(split.hasSplitDescendant, true);
  assert.equal(split.pickupNumber, null);

  assert.equal(mapRestaurantKioskTrace({ ...row, status: "ACCEPTED",
    check_status: "CLOSING", order_status: "COMPLETED", paid_at: submittedAt }, null,
    [{ ...line, check_status: "CLOSING", order_status: "COMPLETED", paid_at: submittedAt }]).settlement, "REVIEW");
  assert.equal(mapRestaurantKioskTrace({ ...row, status: "ACCEPTED",
    check_status: "PAID", order_status: "RETURNED", paid_at: submittedAt }, null,
    [{ ...line, returned_qty: 2, check_status: "PAID", order_status: "RETURNED" }]).settlement, "RETURNED");
  assert.equal(mapRestaurantKioskTrace({ ...row, status: "REJECTED",
    check_status: "PAID", order_status: "COMPLETED", paid_at: submittedAt }).settlement, "NOT_APPLICABLE");
});

test("line evidence prevents false paid states after split, return and legacy acceptance", () => {
  const accepted = { ...row, status: "ACCEPTED", check_status: "PAID",
    order_status: "COMPLETED", paid_at: submittedAt };
  assert.equal(mapRestaurantKioskTrace(accepted).settlement, "REVIEW");
  assert.equal(mapRestaurantKioskTrace(accepted).lineTraceComplete, false);
  assert.equal(mapRestaurantKioskTrace({ ...accepted, item_count: 2 }, null,
    [{ ...line, check_status: "PAID", order_status: "COMPLETED", paid_at: submittedAt }]).settlement, "REVIEW");
  const partlyReturned = mapRestaurantKioskTrace(accepted, null,
    [{ ...line, check_status: "PAID", order_status: "COMPLETED", paid_at: submittedAt,
      returned_qty: 1 }]);
  assert.equal(partlyReturned.settlement, "REVIEW");
  assert.equal(partlyReturned.lines[0].settlement, "PARTIAL_RETURN");
  assert.equal(mapRestaurantKioskTraceLine({ ...line, item_status: "CANCELLED" }).settlement, "CANCELLED");
  assert.equal(mapRestaurantKioskTraceLine({ ...line, order_item_id: null,
    check_status: "PAID", order_status: "COMPLETED", paid_at: submittedAt }).settlement, "REVIEW");
  assert.equal(mapRestaurantKioskTrace({ ...accepted, item_count: 2 }, null,
    [{ ...line, check_status: "PAID", order_status: "COMPLETED", paid_at: submittedAt },
      { ...line, line_no: 2, check_item_id: "88888888-8888-4888-8888-888888888888",
        order_id: "99999999-9999-4999-8999-999999999999", order_status: "PENDING",
        check_status: "OPEN", paid_at: null }]).settlement, "REVIEW");
});

test("manager trace route enforces staff and branch scope before reading data", async () => {
  const route = await readFile(new URL("../apps/web/app/api/bms/restaurant-kiosk-trace/route.ts", import.meta.url), "utf8");
  const service = await readFile(new URL("../apps/web/lib/bms/restaurantKioskTrace.ts", import.meta.url), "utf8");
  assert.match(route, /authorizeAdminRoute\("restaurant\.floor\.manage"\)/);
  assert.ok(route.indexOf("userCanAccessLocation") < route.indexOf("listRestaurantKioskTrace(auth.tenantId"));
  assert.match(service, /kioskTenantRead\(tenantId/);
  assert.match(service, /s\.tenant_id = \$1 AND s\.location_id = \$2/);
  assert.match(service, /s\.id::text LIKE \$3 \|\| '%'/);
  assert.match(service, /LIMIT \$\{code \? 10 : 100\}/);
  assert.match(service, /d\.doc_type IN \('ABBREVIATED', 'FULL'\)/);
  assert.match(service, /d\.issued_at DESC, d\.id DESC LIMIT 1/);
  assert.match(service, /s\.accepted_order_id/);
  assert.match(service, /child\.split_from_check_id = s\.check_id/);
  assert.match(service, /child\.opened_at > s\.reviewed_at/);
  assert.match(service, /jsonb_array_length\(s\.items\)/);
  assert.match(service, /m\.submission_id = ANY\(\$3::uuid\[\]\)/);
  assert.doesNotMatch(service, /SELECT s\.items|s\.idempotency_key|token_hash/);
});

test("accepted order is frozen in the same transaction and migration preserves legacy provenance", async () => {
  const service = await readFile(new URL("../apps/web/lib/bms/restaurantPos.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../db/migrations/10.148__bms_restaurant_kiosk_accepted_order.sql", import.meta.url), "utf8");
  assert.match(service, /accepted_order_id = \$6/);
  assert.match(service, /input\.actorUserId, sent\.orderId/);
  assert.match(service, /acceptedOrderId: sent\.orderId/);
  assert.match(migration, /FOREIGN KEY \(tenant_id, location_id, accepted_order_id\)/);
  assert.match(migration, /OLD\.status = 'ACCEPTED'/);
  assert.match(migration, /OLD\.status <> 'ACCEPTED'/);
  assert.doesNotMatch(migration, /UPDATE bms_restaurant_kiosk_submissions SET accepted_order_id/);
});
