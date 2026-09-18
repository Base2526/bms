import assert from "node:assert/strict";
import test from "node:test";
import {
  initialPosClientFlow,
  transitionPosClientFlow,
} from "../packages/pos-client-core/src/flow.ts";
import {
  calculateCashChange,
  validatePayments,
} from "../packages/pos-client-core/src/payment.ts";

test("desktop and native register flow requires a verified device, cashier PIN, and open shift", () => {
  let state = initialPosClientFlow(true);
  assert.equal(state.stage, "VERIFYING_DEVICE");

  state = transitionPosClientFlow(state, "DEVICE_VERIFIED");
  state = transitionPosClientFlow(state, "SHIFT_STATUS_OPEN");
  assert.equal(state.stage, "CASHIER_LOGIN");
  assert.equal(state.shiftOpen, true);

  state = transitionPosClientFlow(state, "CASHIER_VERIFIED");
  assert.equal(state.stage, "CATALOG");
  state = transitionPosClientFlow(state, "START_CHECKOUT");
  assert.equal(state.stage, "CHECKOUT");
  state = transitionPosClientFlow(state, "SALE_COMPLETED");
  assert.equal(state.stage, "RECEIPT");
});

test("an unopened shift blocks checkout even after cashier verification", () => {
  let state = transitionPosClientFlow(initialPosClientFlow(true), "DEVICE_VERIFIED");
  state = transitionPosClientFlow(state, "CASHIER_VERIFIED");
  assert.equal(state.stage, "SHIFT_REQUIRED");
  state = transitionPosClientFlow(state, "START_CHECKOUT");
  assert.equal(state.stage, "SHIFT_REQUIRED");
});

test("shared payment validation balances split tender and computes cash change", () => {
  const result = validatePayments(250, [
    { id: "cash", method: "cash", amount: 100, tendered: 120 },
    { id: "qr", method: "qr", amount: 150, reference: "TX-1" },
  ]);
  assert.equal(result.canConfirm, true);
  assert.equal(result.paidTotal, 250);
  assert.equal(calculateCashChange(100, 120), 20);
});
