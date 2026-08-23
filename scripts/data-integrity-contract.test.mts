import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { forecastDataQualityFromCounts } from "../apps/web/lib/bms/forecastQuality.ts";
import { validateOrderItems } from "../apps/web/lib/bms/orderValidation.ts";

const migration = readFileSync(
  new URL("../db/migrations/9.15__bms_data_integrity_lifecycle.sql", import.meta.url),
  "utf8"
);
const payments = readFileSync(new URL("../apps/web/lib/bms/payments.ts", import.meta.url), "utf8");
const reports = readFileSync(new URL("../apps/web/lib/bms/reports.ts", import.meta.url), "utf8");
const actions = readFileSync(new URL("../apps/web/lib/bms/actionCenter.ts", import.meta.url), "utf8");
const paymentConfirmRoute = readFileSync(
  new URL("../apps/web/app/api/bms/payment/[id]/confirm/route.ts", import.meta.url),
  "utf8"
);
const paymentRejectRoute = readFileSync(
  new URL("../apps/web/app/api/bms/payment/[id]/reject/route.ts", import.meta.url),
  "utf8"
);
const paymentRefundRoute = readFileSync(
  new URL("../apps/web/app/api/bms/payment/[id]/refund/route.ts", import.meta.url),
  "utf8"
);

test("order validation rejects every malformed quantity instead of dropping a line", () => {
  for (const qty of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648]) {
    const result = validateOrderItems([{ sku: "SKU-1", size: "STD", qty }]);
    assert.equal(result.ok, false, `qty=${qty} must be rejected`);
  }
  assert.deepEqual(validateOrderItems([{ sku: "SKU-1", size: "STD", qty: 1 }]), { ok: true });
});

test("cold-start forecast cannot return a confident recommendation", () => {
  assert.equal(forecastDataQualityFromCounts(0, 0).status, "INSUFFICIENT");
  assert.equal(forecastDataQualityFromCounts(100, 1).status, "INSUFFICIENT");
  assert.equal(forecastDataQualityFromCounts(7, 3).status, "SUFFICIENT");
});

test("payment confirmation and lifecycle dates are atomic and explicit", () => {
  assert.match(payments, /FOR UPDATE/);
  assert.match(payments, /INVALID_ORDER_STATE/);
  assert.match(payments, /confirmed_at = COALESCE\(confirmed_at, now\(\)\)/);
  assert.match(payments, /paid_at = COALESCE\(paid_at, now\(\)\)/);
  assert.match(payments, /INSERT INTO bms_audit_log[\s\S]*payment\.confirm/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS paid_at/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS refunded_at/);
});

test("legacy payment REST mutations require signed tenant-scoped RBAC", () => {
  for (const route of [paymentConfirmRoute, paymentRejectRoute, paymentRefundRoute]) {
    assert.match(route, /verifyAdminSession\(\)/);
    assert.match(route, /verifyActTenant/);
    assert.doesNotMatch(route, /confirmPayment\(DEFAULT_TENANT_ID|rejectPayment\(DEFAULT_TENANT_ID|refundPayment\(DEFAULT_TENANT_ID/);
  }
  assert.match(paymentConfirmRoute, /"payment\.confirm"/);
  assert.match(paymentRejectRoute, /"payment\.confirm"/);
  assert.match(paymentRefundRoute, /"payment\.refund"/);
});

test("reports attribute late events to Bangkok business dates", () => {
  assert.match(reports, /Asia\/Bangkok/);
  assert.match(reports, /bms_pos_refund_allocations/);
  assert.match(reports, /COALESCE\(a\.completed_at, a\.updated_at\)/);
  assert.match(reports, /WHEN status='CANCELLED' THEN COALESCE\(cancelled_at,updated_at,created_at\)/);
});

test("data-quality actions expose missing, duplicate, conflict and outlier evidence", () => {
  for (const actionKey of [
    "margin:missing-cost",
    "margin:zero-price",
    "customer:missing-checkout",
    "customer:possible-duplicates",
    "payment:order-conflict",
    "sales:high-value-outlier",
  ]) {
    assert.match(actions, new RegExp(actionKey));
  }
});
