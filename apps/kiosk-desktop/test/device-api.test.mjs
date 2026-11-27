import { test } from "node:test";
import assert from "node:assert/strict";
import { createKioskDeviceApi, KioskDeviceApiError } from "../src/device-api.mjs";

test("device API sends credential only to the fixed origin and fails closed", async () => {
  const seen = [];
  const api = createKioskDeviceApi(async (url, options) => {
    seen.push({ url: String(url), options });
    return new Response(JSON.stringify({ pinConfigured: true, status: "OK",
      storeName: "FAKE shop", locationName: "FAKE branch",
      pinVersion: "11111111-1111-4111-8111-111111111111" }),
      { status: 200, headers: { "content-type": "application/json" } });
  });
  await api.status("https://bms.jachoei.com", "secret");
  await api.verifyPin("https://bms.jachoei.com", "secret", "123456");
  await api.bind("https://bms.jachoei.com", "secret", "a".repeat(43),
    "11111111-1111-4111-8111-111111111111");
  assert.equal(seen[0].url, "https://bms.jachoei.com/api/bms/restaurant-kiosk-device");
  assert.equal(seen[0].options.headers["x-kiosk-device-token"], "secret");
  assert.equal(JSON.parse(seen[1].options.body).pin, "123456");
  assert.equal(seen[1].options.redirect, "manual");
  assert.deepEqual(JSON.parse(seen[2].options.body), { action: "bind",
    publicToken: "a".repeat(43), pinVersion: "11111111-1111-4111-8111-111111111111" });
  const offline = createKioskDeviceApi(async () => { throw Error("offline"); });
  await assert.rejects(offline.verifyPin("https://bms.jachoei.com", "secret", "123456"),
    (error) => error instanceof KioskDeviceApiError && error.code === "NETWORK");
  const revoked = createKioskDeviceApi(async () => new Response("{}", { status: 401 }));
  await assert.rejects(revoked.status("https://bms.jachoei.com", "secret"),
    (error) => error.code === "REVOKED");
  const publicSeen = [];
  const menu = createKioskDeviceApi(async (url, options) => {
    publicSeen.push({ url: String(url), options });
    return new Response(JSON.stringify({ storeName: "FAKE shop", locationName: "FAKE branch" }), { status: 200 });
  });
  assert.deepEqual(await menu.publicMenu("https://bms.jachoei.com", "a".repeat(43)),
    { storeName: "FAKE shop", locationName: "FAKE branch" });
  assert.equal(publicSeen[0].options.headers, undefined);
  assert.equal(publicSeen[0].url.includes("/api/bms/restaurant-kiosk/"), true);
  const gone = createKioskDeviceApi(async () => new Response("{}", { status: 410 }));
  await assert.rejects(gone.publicMenu("https://bms.jachoei.com", "a".repeat(43)),
    (error) => error.code === "BINDING");
});
