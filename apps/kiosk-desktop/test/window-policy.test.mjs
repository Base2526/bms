import { test } from "node:test";
import assert from "node:assert/strict";
import { staffWebPreferences, guestWebPreferences, guestMayNavigate, redactExternalReferrer } from "../src/window-policy.mjs";

test("customer renderer has no staff preload, IPC or persistent partition", () => {
  const staff = staffWebPreferences("/bundled/preload.cjs");
  const guest = guestWebPreferences("bms-kiosk-customer-11111111-1111-4111-8111-111111111111");
  assert.equal(staff.preload, "/bundled/preload.cjs");
  assert.equal(Object.hasOwn(guest, "preload"), false);
  assert.equal(guest.nodeIntegration, false);
  assert.equal(guest.contextIsolation, true);
  assert.equal(guest.sandbox, true);
  assert.equal(guest.partition.startsWith("persist:"), false);
  assert.equal(guestMayNavigate("https://bms.jachoei.com/pos", "https://bms.jachoei.com/kiosk/x"), false);
  assert.equal(guestMayNavigate("https://bms.jachoei.com/kiosk/x", "https://bms.jachoei.com/kiosk/x"), true);
  const headers = { Referer: "https://bms.jachoei.com/kiosk/secret", Accept: "image/webp" };
  assert.deepEqual(redactExternalReferrer("https://images.example.invalid/food.jpg", "https://bms.jachoei.com", headers),
    { Accept: "image/webp" });
  assert.deepEqual(redactExternalReferrer("https://bms.jachoei.com/api/menu", "https://bms.jachoei.com", headers), headers);
});
