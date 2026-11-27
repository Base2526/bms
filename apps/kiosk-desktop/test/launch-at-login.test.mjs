import { test } from "node:test";
import assert from "node:assert/strict";
import { configureKioskAutostart } from "../src/launch-at-login.mjs";

test("packaged Windows kiosk registers per-user launch and reports OS rejection", () => {
  let calls = 0;
  const app = { setLoginItemSettings(input) { calls++; assert.equal(input.openAtLogin, true); },
    getLoginItemSettings() { return { openAtLogin: true }; } };
  assert.equal(configureKioskAutostart(app, false, "win32").configured, false);
  assert.equal(calls, 0);
  assert.equal(configureKioskAutostart(app, true, "win32").configured, true);
  assert.equal(calls, 1);
  assert.equal(configureKioskAutostart({ setLoginItemSettings() { throw Error("denied"); } }, true, "win32").reason,
    "OS_REGISTRATION_FAILED");
});
