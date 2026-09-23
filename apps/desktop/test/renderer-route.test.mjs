import assert from "node:assert/strict";
import test from "node:test";
import {
  cachedPosEntryPath,
  LEGACY_POS_PATH,
  MOBILE_POS_PATH,
  posEntryPathForStatus,
  resolvePosEntryPath,
} from "../src/renderer-route.mjs";

test("restores only a client-owned POS entry path", () => {
  assert.equal(cachedPosEntryPath(MOBILE_POS_PATH), MOBILE_POS_PATH);
  assert.equal(cachedPosEntryPath(LEGACY_POS_PATH), LEGACY_POS_PATH);
  assert.equal(cachedPosEntryPath("/admin"), null);
  assert.equal(cachedPosEntryPath(undefined), null);
});

test("opens the mobile-flow renderer when the paired server has it", () => {
  assert.equal(posEntryPathForStatus(200), MOBILE_POS_PATH);
  assert.equal(posEntryPathForStatus(401), MOBILE_POS_PATH);
  assert.equal(posEntryPathForStatus(500), MOBILE_POS_PATH);
});

test("falls back to the existing POS when a pre-rollout server returns 404", () => {
  assert.equal(posEntryPathForStatus(404), LEGACY_POS_PATH);
});

test("compatibility probe resolves the entry path", async () => {
  assert.equal(await resolvePosEntryPath(async () => 200, 50), MOBILE_POS_PATH);
  assert.equal(await resolvePosEntryPath(async () => 404, 50), LEGACY_POS_PATH);
});

test("a failed compatibility probe keeps the current renderer", async () => {
  assert.equal(await resolvePosEntryPath(async () => {
    throw new Error("network unavailable");
  }, 50), MOBILE_POS_PATH);
});

test("a hanging compatibility probe times out and aborts without selecting the legacy route", async () => {
  let aborted = false;
  const entryPath = await resolvePosEntryPath((signal) => new Promise(() => {
    signal.addEventListener("abort", () => { aborted = true; });
  }), 10);
  assert.equal(entryPath, MOBILE_POS_PATH);
  assert.equal(aborted, true);
});
