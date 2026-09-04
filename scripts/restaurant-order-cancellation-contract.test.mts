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
  assert.match(adminPage, /pendingRefundAmount/);
});

