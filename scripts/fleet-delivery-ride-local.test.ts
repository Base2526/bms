import assert from "node:assert/strict";
import test from "node:test";
import {
  isOwnedRideSandboxCommand,
  keychainServiceName,
  parseAdbDeviceSerials,
} from "./fleet-delivery-ride-local.js";

test("ride Keychain services are deterministic and reject unrelated secret names", () => {
  assert.equal(
    keychainServiceName("BMS_RIDE_GOOGLE_ROUTES_KEY"),
    "com.bms.ride-sandbox.local.bms_ride_google_routes_key",
  );
  assert.throws(() => keychainServiceName("DATABASE_URL"), /UNSUPPORTED_RIDE_SECRET/);
});

test("adb setup targets only authorized connected devices", () => {
  assert.deepEqual(
    parseAdbDeviceSerials(
      "List of devices attached\nemulator-5554\tdevice\nphone\tunauthorized\nusb-1\tdevice product:test\n",
    ),
    ["emulator-5554", "usb-1"],
  );
});

test("port replacement recognizes only the explicit ride launcher", () => {
  assert.equal(
    isOwnedRideSandboxCommand(
      "/usr/local/bin/node --import tsx scripts/fleet-delivery-ride-sandbox.ts",
    ),
    true,
  );
  assert.equal(isOwnedRideSandboxCommand("node unrelated-server.js"), false);
});
