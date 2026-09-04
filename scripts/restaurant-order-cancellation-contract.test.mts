import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { couponEligibilitySubtotal, merchantAbsorbApproval, reconcileRestaurantCancellation } from "../apps/web/lib/bms/restaurantCancellationPolicy";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("mixed cancellation causes preserve coupon threshold credit only for merchant-caused value", () => {
  assert.equal(couponEligibilitySubtotal({ remainingSubtotal: 400, merchantCancelledSubtotal: 100 }), 500);
  assert.equal(couponEligibilitySubtotal({ remainingSubtotal: 400, merchantCancelledSubtotal: 0 }), 400);
});

test("merchant absorb has a separate configurable approval threshold", () => {
  assert.equal(merchantAbsorbApproval({ amount: 1999, limit: 2000, hasDistinctManagerApproval: false }).allowed, true);
  assert.equal(merchantAbsorbApproval({ amount: 2001, limit: 2000, hasDistinctManagerApproval: false }).approvalRequired, true);
  assert.equal(merchantAbsorbApproval({ amount: 2001, limit: 2000, hasDistinctManagerApproval: true }).allowed, true);
  assert.doesNotMatch(withoutComments(read("apps/web/lib/bms/restaurantCancellationPolicy.ts")), /approvalRuleForRefundAmount/);
});

test("merchant-absorbed repricing keeps the bill balanced", () => {
  assert.deepEqual(reconcileRestaurantCancellation({ paidAmount: 400, remainingLinesAmount: 450, merchantAbsorbedAmount: 50 }), {
    refundAmount: 0, balancedAmount: 400,
  });
});

test("online cancellation uses the POS return engine with immutable causes and partial kitchen cancellation", () => {
  const pos = withoutComments(read("apps/web/lib/bms/pos.ts"));
  const kitchen = read("apps/web/lib/bms/kitchen.ts");
  const route = read("apps/web/app/api/pos/restaurant/incoming/route.ts");
  const migration = read("db/migrations/9.57__bms_restaurant_order_line_cancellation.sql");
  assert.match(pos, /deviceId: null/);
  assert.match(pos, /priceRemainingLines\(/);
  assert.match(pos, /releaseCouponForOrdersInTx/);
  assert.match(pos, /MERCHANT_ABSORBED/);
  assert.match(pos, /cancelKitchenTicketsForOrderItemsInTx/);
  assert.match(pos, /order\.location_id !== input\.restaurantCancellation!\.expectedLocationId/);
  assert.match(pos, /order\.fulfillment_type === null/);
  assert.match(pos, /\["PAID", "PACKING"\]\.includes\(order\.status\)/);
  assert.match(pos, /approverId, "restaurant\.floor\.manage"/);
  assert.match(kitchen, /order_item_id = ANY/);
  assert.match(route, /order\.line\.cancel/);
  assert.match(route, /cancel_lines/);
  assert.match(migration, /trg_bms_cancellation_cause_immutable/);
  assert.match(migration, /'Cashier'\)/);
  assert.doesNotMatch(migration, /'Cashier'\s*,\s*'order\.return'/);
});

test("POS owns both cancellation and refund-queue controls while admin mirrors pending totals", () => {
  const posPage = read("apps/web/app/(pos)/pos/page.tsx");
  const adminPage = read("apps/web/app/(admin)/admin/orders/page.tsx");
  assert.match(posPage, /ตัดรายการ \/ คืนส่วนต่าง/);
  assert.match(posPage, /คิวคืนเงินเดลิเวอรี/);
  assert.match(posPage, /externalRef/);
  assert.match(posPage, /data\?\.status === "APPROVAL_REQUIRED"/);
  assert.match(posPage, /restaurant\.floor\.manage/);
  assert.match(posPage, /managerUserId: manager\.id, managerPin/);
  assert.match(posPage, /ปิดเมนู “\$\{item\.name\}” เป็นหมดวันนี้ที่สาขานี้ด้วยหรือไม่/);
  assert.match(posPage, /productSku: item\.sku[\s\S]{0,120}unavailable: true/);
  assert.match(adminPage, /pendingRefundAmount/);
});

test("an online refund is closable only by a register in the sale branch with a transfer reference", () => {
  const pos = withoutComments(read("apps/web/lib/bms/pos.ts"));
  const route = read("apps/web/app/api/pos/refund-settlement/route.ts");
  assert.match(pos, /pr\.pos_device_id IS NULL/);
  assert.match(pos, /o\.location_id = \$4/);
  assert.match(pos, /o\.fulfillment_type IS NOT NULL/);
  assert.match(pos, /row\.online_refund \|\| row\.method !== "CASH"/);
  assert.match(route, /locationId: device\.locationId/);
});

test("9.57 replaces only the source value list, never the points_used guard", () => {
  // bms_order_discounts (7.96) has TWO check constraints whose definition mentions "source":
  // the value list, and CHECK (points_used = 0 OR source = 'POINTS'). Matching on LIKE '%source%'
  // picks one at random — drop the wrong one and every MERCHANT_ABSORBED insert fails a check
  // violation while the points_used guard disappears with no error anywhere.
  const migration = withoutComments(read("db/migrations/9.57__bms_restaurant_order_line_cancellation.sql"));
  assert.doesNotMatch(migration, /pg_get_constraintdef\(oid\) LIKE '%source%'/);
  assert.match(migration, /array_length\(c\.conkey, 1\) = 1/);
  assert.match(migration, /a\.attname = 'source'/);
  assert.match(migration, /LIKE '%TIER%'/);
  assert.match(migration, /'MERCHANT_ABSORBED'/);
  // Wrapped so a failure part-way through cannot leave half of these columns applied.
  assert.match(migration, /^BEGIN;$/m);
  assert.match(migration, /^COMMIT;$/m);
});

test("releasing a reservation refuses a fractional quantity instead of letting Postgres round it", () => {
  // bms_inventory.reserved_stock is INTEGER (3.2). The counter-return branch has always refused a
  // non-divisible component quantity; the online-cancellation branch released it unguarded, so a
  // malformed consumption snapshot would silently round stock and leave untraceable drift.
  const pos = withoutComments(read("apps/web/lib/bms/pos.ts"));
  const online = pos.slice(pos.indexOf("if (onlineCancellation) {"));
  const branch = online.slice(0, online.indexOf("returnedItems.push"));
  assert.match(branch, /Number\.isInteger\(exactQty\)/);
  assert.match(branch, /reserved_stock = reserved_stock - \$5/);
});

test("a cancel_lines request with any unreadable line is rejected whole", () => {
  // Cancelling the readable subset takes food off a customer's order and refunds a different
  // amount than the register asked for, with nothing saying a line was dropped.
  const route = withoutComments(read("apps/web/app/api/pos/restaurant/incoming/route.ts"));
  assert.match(route, /lines\.length !== requestedLines\.length/);
  assert.match(route, /lines\.length !== requestedLines\.length[\s\S]{0,320}status: 400/);
});
