import assert from "node:assert/strict";
import test from "node:test";
import { evaluateDriverLocation } from "./index.js";

test("driver location policy rejects stale, mock, inaccurate, out-of-order and impossible travel", () => {
  const receivedAt = new Date("2026-10-18T10:00:00Z");
  const base = { sequence: 2, deviceObservedAt: receivedAt, receivedAt, accuracyM: 10, mockLocation: false };
  assert.deepEqual(evaluateDriverLocation(base), { accepted: true, reason: null });
  assert.equal(evaluateDriverLocation({ ...base, deviceObservedAt: new Date("2026-10-18T09:57:59Z") }).reason, "STALE");
  assert.equal(evaluateDriverLocation({ ...base, deviceObservedAt: new Date("2026-10-18T10:00:31Z") }).reason, "FUTURE_TIME");
  assert.equal(evaluateDriverLocation({ ...base, mockLocation: true }).reason, "MOCK_SIGNAL");
  assert.equal(evaluateDriverLocation({ ...base, accuracyM: 201 }).reason, "INACCURATE");
  assert.equal(evaluateDriverLocation({ ...base, previous: {
    sequence: 2, deviceObservedAt: new Date("2026-10-18T09:59:50Z"), distanceM: 10,
  } }).reason, "OUT_OF_ORDER");
  assert.equal(evaluateDriverLocation({ ...base, previous: {
    sequence: 1, deviceObservedAt: new Date("2026-10-18T09:59:50Z"), distanceM: 1_000,
  } }).reason, "IMPOSSIBLE_TRAVEL");
});
