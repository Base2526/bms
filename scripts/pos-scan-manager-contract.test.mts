import assert from "node:assert/strict";
import test from "node:test";

import {
  consumeKeyboardWedgeKey,
  DEFAULT_KEYBOARD_WEDGE_CONFIG,
  IDLE_KEYBOARD_WEDGE_STATE,
  resolveScanContext,
  type KeyboardWedgeState,
} from "../apps/web/lib/pos/scanManager.ts";

const prefixConfig = { ...DEFAULT_KEYBOARD_WEDGE_CONFIG, mode: "PREFIX" as const };

test("focus mode never globally captures normal keyboard input", () => {
  const result = consumeKeyboardWedgeKey(
    IDLE_KEYBOARD_WEDGE_STATE,
    { key: "8" },
    DEFAULT_KEYBOARD_WEDGE_CONFIG,
    0
  );
  assert.equal(result.capture, false);
  assert.equal(result.completedCode, undefined);
});

test("prefix mode captures the whole payload and completes on suffix", () => {
  let state: KeyboardWedgeState = IDLE_KEYBOARD_WEDGE_STATE;
  let now = 0;
  for (const key of ["F9", ..."8851234567890", "Enter"]) {
    const result = consumeKeyboardWedgeKey(state, { key }, prefixConfig, now += 10);
    assert.equal(result.capture, true);
    state = result.state;
    if (key === "Enter") assert.equal(result.completedCode, "8851234567890");
  }
  assert.equal(state.phase, "IDLE");
});

test("ordinary typing is untouched until the positive prefix arrives", () => {
  const result = consumeKeyboardWedgeKey(
    IDLE_KEYBOARD_WEDGE_STATE,
    { key: "ส" },
    prefixConfig,
    10
  );
  assert.equal(result.capture, false);
});

test("a timed-out scanner frame is quarantined until its suffix", () => {
  const armed = consumeKeyboardWedgeKey(
    IDLE_KEYBOARD_WEDGE_STATE,
    { key: "F9" },
    prefixConfig,
    0
  );
  const timedOut = consumeKeyboardWedgeKey(armed.state, { key: "A" }, prefixConfig, 1000);
  assert.equal(timedOut.capture, true);
  assert.equal(timedOut.rejected, "TIMEOUT");
  assert.equal(timedOut.state.phase, "DISCARDING");

  const remainder = consumeKeyboardWedgeKey(timedOut.state, { key: "8" }, prefixConfig, 1010);
  assert.equal(remainder.capture, true);
  assert.equal(remainder.state.phase, "DISCARDING");

  const released = consumeKeyboardWedgeKey(remainder.state, { key: "Enter" }, prefixConfig, 1020);
  assert.equal(released.capture, true);
  assert.equal(released.state.phase, "IDLE");
  assert.equal(released.completedCode, undefined);
});

test("an overlong scanner frame cannot leak its tail into the focused input", () => {
  let state: KeyboardWedgeState = consumeKeyboardWedgeKey(
    IDLE_KEYBOARD_WEDGE_STATE,
    { key: "F9" },
    prefixConfig,
    0
  ).state;
  for (let index = 0; index < 128; index += 1) {
    state = consumeKeyboardWedgeKey(state, { key: "1" }, prefixConfig, index + 1).state;
  }
  const rejected = consumeKeyboardWedgeKey(state, { key: "2" }, prefixConfig, 130);
  assert.equal(rejected.capture, true);
  assert.equal(rejected.rejected, "TOO_LONG");
  assert.equal(rejected.state.phase, "DISCARDING");
  const tail = consumeKeyboardWedgeKey(rejected.state, { key: "3" }, prefixConfig, 131);
  assert.equal(tail.capture, true);
  assert.equal(tail.state.phase, "DISCARDING");
});

test("scan context is explicit and never inferred from focused input", () => {
  const base = {
    lookupMode: false,
    blindReturnOpen: false,
    hasPendingSale: false,
    busy: false,
    blockingOverlayOpen: false,
  };
  assert.equal(resolveScanContext({ ...base, tab: "sell" }), "SALE");
  assert.equal(resolveScanContext({ ...base, tab: "sell", lookupMode: true }), "PRODUCT_LOOKUP");
  assert.equal(resolveScanContext({ ...base, tab: "returns" }), "RETURN_RECEIPT");
  assert.equal(resolveScanContext({ ...base, tab: "returns", blindReturnOpen: true }), "BLIND_RETURN_ITEM");
  assert.equal(resolveScanContext({ ...base, tab: "stock" }), "STOCK_RECEIVE");
  assert.equal(resolveScanContext({ ...base, tab: "shift" }), "DISABLED");
  assert.equal(resolveScanContext({ ...base, tab: "sell", hasPendingSale: true }), "DISABLED");
  assert.equal(resolveScanContext({ ...base, tab: "sell", blockingOverlayOpen: true }), "DISABLED");
});
