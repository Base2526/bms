import assert from "node:assert/strict";
import test from "node:test";

import {
  POS_ASSET_RECOVERY_PARAM,
  isPosAssetLoadError,
  posAssetRecoveryUrl,
  posAssetRecoveryWasAttempted,
} from "../apps/web/lib/posAssetRecovery.ts";

test("POS asset recovery recognizes stale CSS and JavaScript chunks only", () => {
  assert.equal(isPosAssetLoadError({
    name: "Error",
    message: "Loading CSS chunk _app-pages-browser_app_pos_pos_page_tsx-_ff950 failed.",
  }), true);
  assert.equal(isPosAssetLoadError({ name: "ChunkLoadError", message: "Loading chunk 918 failed." }), true);
  assert.equal(isPosAssetLoadError({
    name: "TypeError",
    message: "Failed to fetch dynamically imported module: https://example.test/chunk.js",
  }), true);
  assert.equal(isPosAssetLoadError({ name: "Error", message: "การชำระเงินไม่สำเร็จ" }), false);
});

test("POS asset recovery keeps the current route and adds a fresh manifest nonce", () => {
  const now = 1_794_234_000_000;
  const recovered = new URL(posAssetRecoveryUrl("https://jachoei.com/pos/restaurant?screen=floor", now));

  assert.equal(recovered.pathname, "/pos/restaurant");
  assert.equal(recovered.searchParams.get("screen"), "floor");
  assert.equal(recovered.searchParams.get(POS_ASSET_RECOVERY_PARAM), String(now));
});

test("POS asset recovery permits one automatic reload per minute and fails closed", () => {
  const now = 1_794_234_000_000;
  const attempted = posAssetRecoveryUrl("https://jachoei.com/pos/restaurant", now - 10_000);
  const expired = posAssetRecoveryUrl("https://jachoei.com/pos/restaurant", now - 60_001);

  assert.equal(posAssetRecoveryWasAttempted(attempted, now), true);
  assert.equal(posAssetRecoveryWasAttempted(expired, now), false);
  assert.equal(posAssetRecoveryWasAttempted("not a valid URL", now), true);
});
