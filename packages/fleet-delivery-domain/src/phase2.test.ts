import assert from "node:assert/strict";
import test from "node:test";
import { calculateQuotePricing, isOpenAt, nextDeliveryState, nextDriverJourneyState } from "./index.js";

test("quote pricing uses started kilometres, minimums, subsidy caps and half-up commission", () => {
  assert.deepEqual(calculateQuotePricing({
    distanceMeters: 1_001,
    baseFareSatang: 1_500,
    perStartedKmSatang: 700,
    minimumFareSatang: 2_000,
    fixedMerchantSubsidySatang: 500,
    commissionBps: 500,
  }), {
    billableDistanceMeters: 1_001,
    startedKilometres: 2,
    baseFareSatang: 1_500,
    distanceChargeSatang: 1_400,
    grossDeliveryFeeSatang: 2_900,
    customerContributionSatang: 2_400,
    merchantSubsidySatang: 500,
    explicitDiscountSatang: 0,
    eligibleCommissionFeeSatang: 2_900,
    commissionSatang: 145,
  });
  assert.equal(calculateQuotePricing({
    distanceMeters: 100,
    baseFareSatang: 0,
    perStartedKmSatang: 100,
    minimumFareSatang: 999,
    fixedMerchantSubsidySatang: 2_000,
    commissionBps: 500,
  }).merchantSubsidySatang, 999);
});

test("phase 2 delivery transitions are named and reject skipped or post-terminal actions", () => {
  assert.equal(nextDeliveryState("AWAITING_PAYMENT", "payment_confirmed"), "AWAITING_MERCHANT_ACCEPTANCE");
  assert.equal(nextDeliveryState("AWAITING_MERCHANT_ACCEPTANCE", "merchant_accepted"), "PREPARING");
  assert.equal(nextDeliveryState("PREPARING", "merchant_ready"), "READY_FOR_DISPATCH");
  assert.equal(nextDeliveryState("READY_FOR_DISPATCH", "cancel_before_pickup"), "CANCELLED");
  assert.throws(() => nextDeliveryState("AWAITING_PAYMENT", "merchant_ready"), /INVALID_DELIVERY_TRANSITION/);
  assert.throws(() => nextDeliveryState("CANCELLED", "payment_confirmed"), /INVALID_DELIVERY_TRANSITION/);
});

test("merchant hours are evaluated in the configured reporting timezone", () => {
  const mondayBangkokNoon = new Date("2026-10-19T05:00:00.000Z");
  assert.equal(isOpenAt([{ dayOfWeek: 1, opensAt: "09:00", closesAt: "17:00" }], mondayBangkokNoon, "Asia/Bangkok"), true);
  assert.equal(isOpenAt([{ dayOfWeek: 1, opensAt: "13:00", closesAt: "17:00" }], mondayBangkokNoon, "Asia/Bangkok"), false);
});

test("phase 4 pickup journey is ordered and cannot skip arrival", () => {
  assert.equal(nextDriverJourneyState("ASSIGNED", "start_pickup"), "EN_ROUTE_PICKUP");
  assert.equal(nextDriverJourneyState("EN_ROUTE_PICKUP", "arrive_pickup"), "AT_PICKUP");
  assert.throws(
    () => nextDriverJourneyState("ASSIGNED", "arrive_pickup"),
    /INVALID_DRIVER_JOURNEY_TRANSITION/,
  );
  assert.throws(
    () => nextDriverJourneyState("AT_PICKUP", "start_pickup"),
    /INVALID_DRIVER_JOURNEY_TRANSITION/,
  );
});

test("post-pickup delivery and failure-return journeys remain ordered", () => {
  assert.equal(nextDeliveryState("AT_PICKUP", "merchant_handoff"), "PICKED_UP");
  assert.equal(nextDriverJourneyState("PICKED_UP", "start_delivery"), "IN_TRANSIT");
  assert.equal(nextDriverJourneyState("IN_TRANSIT", "arrive_dropoff"), "AT_DROPOFF");
  assert.equal(nextDriverJourneyState("AT_DROPOFF", "deliver_with_pod"), "DELIVERED");
  assert.equal(nextDeliveryState("DELIVERED", "complete_delivery"), "COMPLETED");
  assert.throws(
    () => nextDriverJourneyState("IN_TRANSIT", "deliver_with_pod"),
    /INVALID_DRIVER_JOURNEY_TRANSITION/,
  );

  assert.equal(nextDriverJourneyState("IN_TRANSIT", "report_failure"), "DELIVERY_FAILED");
  assert.equal(nextDeliveryState("DELIVERY_FAILED", "request_return"), "RETURN_REQUESTED");
  assert.equal(nextDeliveryState("RETURN_REQUESTED", "approve_return"), "RETURN_APPROVED");
  assert.equal(nextDriverJourneyState("RETURN_APPROVED", "start_return"), "RETURN_IN_TRANSIT");
  assert.equal(nextDriverJourneyState("RETURN_IN_TRANSIT", "arrive_return"), "RETURNED_TO_MERCHANT");
  assert.equal(nextDeliveryState("RETURNED_TO_MERCHANT", "review_return"), "RETURN_REVIEW");
  assert.equal(nextDeliveryState("RETURN_REVIEW", "resolve_return"), "RETURN_RESOLVED");
  assert.throws(
    () => nextDeliveryState("DELIVERY_FAILED", "complete_delivery"),
    /INVALID_DELIVERY_TRANSITION/,
  );
});
