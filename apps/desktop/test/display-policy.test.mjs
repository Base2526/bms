import assert from "node:assert/strict";
import test from "node:test";
import {
  customerDisplayPreviewBounds,
  DEFAULT_CUSTOMER_DISPLAY_CONFIG,
  DEFAULT_QUEUE_DISPLAY_CONFIG,
  MAX_QUEUE_DISPLAYS,
  normalizeCustomerDisplayConfig,
  normalizeQueueDisplayConfig,
  queueDisplayPreviewBounds,
  queueClaimsCustomerDisplay,
  selectQueueDisplay,
  selectQueueDisplays,
  selectCustomerDisplay,
} from "../src/display-policy.mjs";

const displays = [{ id: 10 }, { id: 20 }, { id: 30 }];

test("first-run can offer setup once, without overriding a legacy explicit choice", () => {
  assert.equal(normalizeCustomerDisplayConfig(null).configured, false);
  for (const mode of ["off", "auto", "selected"]) {
    const saved = normalizeCustomerDisplayConfig({ mode, targetDisplayId: "20" });
    assert.equal(saved.configured, true);
    assert.deepEqual(normalizeCustomerDisplayConfig(JSON.parse(JSON.stringify(saved))), saved);
  }
  assert.equal(selectCustomerDisplay(displays, 10, { mode: "off" }), null);
});

test("selected screen reconnect restores the target without stealing the cashier screen", () => {
  const config = { mode: "selected", targetDisplayId: "20" };
  assert.equal(selectCustomerDisplay([{ id: 10 }], 10, config), null);
  assert.equal(selectCustomerDisplay(displays, 10, config)?.id, 20);
  assert.equal(selectCustomerDisplay(displays, 20, config), null);
});

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

test("one-screen preview stays windowed and inside the cashier work area", () => {
  assert.deepEqual(customerDisplayPreviewBounds({
    workArea: { x: 100, y: 40, width: 1440, height: 900 },
  }), { x: 308, y: 106, width: 1024, height: 768 });
  assert.deepEqual(customerDisplayPreviewBounds({
    bounds: { x: 0, y: 0, width: 800, height: 600 },
  }), { x: 40, y: 40, width: 720, height: 520 });
});

test("queue preview is cascaded while remaining inside the cashier work area", () => {
  assert.deepEqual(queueDisplayPreviewBounds({
    workArea: { x: 100, y: 40, width: 1440, height: 900 },
  }), { x: 364, y: 162, width: 1024, height: 768 });
  assert.deepEqual(queueDisplayPreviewBounds({
    bounds: { x: 0, y: 0, width: 800, height: 600 },
  }), { x: 80, y: 80, width: 720, height: 520 });
});

test("queue display uses the same fail-closed config and never steals customer or cashier screens", () => {
  assert.deepEqual(normalizeQueueDisplayConfig(null), DEFAULT_QUEUE_DISPLAY_CONFIG);
  const config = normalizeQueueDisplayConfig({ mode: "selected", targetDisplayId: "30" });
  assert.equal(selectQueueDisplay(displays, 10, 20, config)?.id, 30);
  assert.equal(selectQueueDisplay(displays, 10, 30, config), null);
  assert.equal(selectQueueDisplay(displays, 10, 20, { mode: "auto" })?.id, 30);
  assert.equal(selectQueueDisplay([{ id: 10 }, { id: 20 }], 10, 20, { mode: "auto" }), null);
});

test("legacy single-screen queue settings migrate without opening extra screens", () => {
  const old = { version: 1, mode: "selected", targetDisplayId: "30", configured: true };
  const next = normalizeQueueDisplayConfig(old);
  assert.equal(next.version, 2);
  assert.deepEqual(next.targetDisplayIds, ["30"]);
  assert.equal(next.displayCount, 1);
  assert.equal(next.audioDisplayId, null);
  assert.deepEqual(normalizeQueueDisplayConfig(next), next);
  assert.equal(normalizeQueueDisplayConfig({ mode: "auto" }).displayCount, 1);
});

test("auto queue allocation is bounded and leaves the cashier and customer displays alone", () => {
  const monitors = [{ id: 10 }, { id: 20 }, { id: 30 }, { id: 40 }, { id: 50 }];
  const config = normalizeQueueDisplayConfig({ mode: "auto", displayCount: 3 });
  assert.equal(MAX_QUEUE_DISPLAYS, 32);
  assert.deepEqual(selectQueueDisplays(monitors, 10, 20, config).map((item) => item.id), [30, 40, 50]);
  assert.deepEqual(selectQueueDisplays(monitors.slice(0, 3), 10, 20, config).map((item) => item.id), [30]);
  assert.deepEqual(selectQueueDisplays(monitors, 10, 20, { mode: "auto", displayCount: 99 }).map((item) => item.id), [30]);
});

test("selected queues dedupe IDs, preserve order and reconnect without stealing another role", () => {
  const config = normalizeQueueDisplayConfig({ mode: "selected",
    targetDisplayIds: ["40", "30", "30", "50", "60"], audioDisplayId: "50" });
  assert.deepEqual(config.targetDisplayIds, ["40", "30", "50", "60"]);
  assert.equal(config.displayCount, 4);
  assert.deepEqual(selectQueueDisplays([{ id: 10 }, { id: 20 }, { id: 30 }, { id: 40 }], 10, 20, config)
    .map((item) => item.id), [40, 30]);
  assert.deepEqual(selectQueueDisplays([{ id: 10 }, { id: 20 }, { id: 30 }, { id: 40 }, { id: 50 }], 10, 30, config)
    .map((item) => item.id), [40, 50]);
  assert.equal(normalizeQueueDisplayConfig({ ...config, targetDisplayIds: ["40"] }).audioDisplayId, null);
  assert.deepEqual(normalizeQueueDisplayConfig({ mode: "selected" }), DEFAULT_QUEUE_DISPLAY_CONFIG);
});

test("queue setup hands off a shared screen, including a saved disconnected customer target", () => {
  assert.equal(queueClaimsCustomerDisplay([{ id: 10 }, { id: 20 }], 10,
    { mode: "auto" }, { mode: "auto", displayCount: 1 }), true);
  assert.equal(queueClaimsCustomerDisplay(displays, 10,
    { mode: "auto" }, { mode: "auto", displayCount: 1 }), false);
  assert.equal(queueClaimsCustomerDisplay(displays, 10,
    { mode: "auto" }, { mode: "selected", targetDisplayIds: ["20"] }), true);
  assert.equal(queueClaimsCustomerDisplay(displays, 10,
    { mode: "selected", targetDisplayId: "99" },
    { mode: "selected", targetDisplayIds: ["99"] }), true);
  assert.equal(queueClaimsCustomerDisplay(displays, 10,
    { mode: "selected", targetDisplayId: "99" },
    { mode: "selected", targetDisplayIds: ["30"] }), false);
  assert.equal(queueClaimsCustomerDisplay([{ id: 10 }, { id: 20 }], 10,
    { mode: "auto" }, { mode: "selected", targetDisplayIds: ["99"] }), false);
  assert.equal(queueClaimsCustomerDisplay(displays, 10,
    { mode: "auto" }, { mode: "off" }), false);
});
