import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CUSTOMER_DISPLAY_CONFIG,
  normalizeCustomerDisplayConfig,
  selectCustomerDisplay,
} from "../src/display-policy.mjs";

const displays = [{ id: 10 }, { id: 20 }, { id: 30 }];

test("customer display is opt-in and malformed settings fail closed", () => {
  assert.deepEqual(normalizeCustomerDisplayConfig(null), DEFAULT_CUSTOMER_DISPLAY_CONFIG);
  assert.deepEqual(normalizeCustomerDisplayConfig({ mode: "many" }), DEFAULT_CUSTOMER_DISPLAY_CONFIG);
  assert.deepEqual(normalizeCustomerDisplayConfig({ mode: "selected" }), DEFAULT_CUSTOMER_DISPLAY_CONFIG);
});

test("auto mode chooses one display other than the cashier display", () => {
  assert.equal(selectCustomerDisplay(displays, 10, { mode: "auto" })?.id, 20);
  assert.equal(selectCustomerDisplay([{ id: 10 }], 10, { mode: "auto" }), null);
});

test("selected mode uses only the connected non-cashier target", () => {
  assert.equal(selectCustomerDisplay(displays, 10, { mode: "selected", targetDisplayId: "30" })?.id, 30);
  assert.equal(selectCustomerDisplay(displays, 10, { mode: "selected", targetDisplayId: "10" }), null);
  assert.equal(selectCustomerDisplay(displays, 10, { mode: "selected", targetDisplayId: "99" }), null);
});
