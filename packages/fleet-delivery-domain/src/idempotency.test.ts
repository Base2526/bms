import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, requestFingerprint, requireIdempotencyKey } from "./index.js";

test("canonical request fingerprint ignores object key order but not values", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(requestFingerprint({ b: 2, a: 1 }), requestFingerprint({ a: 1, b: 2 }));
  assert.notEqual(requestFingerprint({ a: 1 }), requestFingerprint({ a: 2 }));
});

test("idempotency keys are explicit, bounded, and character restricted", () => {
  assert.equal(requireIdempotencyKey("req:test-123"), "req:test-123");
  for (const value of [undefined, "short", "contains space", "x".repeat(161)]) {
    assert.throws(() => requireIdempotencyKey(value));
  }
});
