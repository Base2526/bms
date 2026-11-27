import { test } from "node:test";
import assert from "node:assert/strict";
import { parseKioskUrl, validDeviceCredential } from "../src/url-policy.mjs";

const publicToken = "A".repeat(43);
const credential = `bmsk_${"B".repeat(43)}`;
test("accepts only exact authorized kiosk URLs and device credentials", () => {
  assert.equal(parseKioskUrl(`https://bms.jachoei.com/kiosk/${publicToken}`)?.publicToken, publicToken);
  assert.equal(validDeviceCredential(credential), true);
  for (const value of [
    `http://bms.jachoei.com/kiosk/${publicToken}`,
    `https://evil.test/kiosk/${publicToken}`,
    `https://bms.jachoei.com/kiosk/${publicToken}?redirect=x`,
    `https://bms.jachoei.com/kiosk/${publicToken}/more`,
    `https://user:pass@bms.jachoei.com/kiosk/${publicToken}`,
    `https://bms.jachoei.com/pos/restaurant`,
  ]) assert.equal(parseKioskUrl(value), null, value);
  assert.equal(validDeviceCredential(publicToken), false);
});
