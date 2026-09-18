import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_POS_PATH,
  MOBILE_POS_PATH,
  posEntryPathForStatus,
} from "../src/renderer-route.mjs";

test("opens the mobile-flow renderer when the paired server has it", () => {
  assert.equal(posEntryPathForStatus(200), MOBILE_POS_PATH);
  assert.equal(posEntryPathForStatus(401), MOBILE_POS_PATH);
  assert.equal(posEntryPathForStatus(500), MOBILE_POS_PATH);
});

test("falls back to the existing POS when a pre-rollout server returns 404", () => {
  assert.equal(posEntryPathForStatus(404), LEGACY_POS_PATH);
});
