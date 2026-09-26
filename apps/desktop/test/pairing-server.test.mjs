import assert from "node:assert/strict";
import test from "node:test";
import {
  adminUrlForServer,
  assertPairingServerResponse,
  canRecoverByStartingManagedLocalRuntime,
  PairingServerResponseError,
} from "../src/pairing-server.mjs";

test("admin URL follows the paired server origin without carrying POS credentials", () => {
  assert.equal(adminUrlForServer("http://127.0.0.1:3100"), "http://127.0.0.1:3100/admin/login");
  assert.equal(adminUrlForServer("https://shop.example.com"), "https://shop.example.com/admin/login");
  assert.doesNotMatch(adminUrlForServer("https://shop.example.com"), /token|pos_/i);
});

test("pairing server probe accepts only successful HTTP responses", () => {
  assert.doesNotThrow(() => assertPairingServerResponse({ ok: true, status: 200 }));
  assert.throws(
    () => assertPairingServerResponse({ ok: false, status: 502 }),
    (error) => error instanceof PairingServerResponseError
      && error.status === 502
      && error.userMessage.includes("HTTP 502"),
  );
});

test("pairing server probe gives actionable authentication errors", () => {
  assert.throws(
    () => assertPairingServerResponse({ ok: false, status: 401 }),
    (error) => error.userMessage.includes("จับคู่เครื่องใหม่"),
  );
  assert.throws(
    () => assertPairingServerResponse({ ok: false, status: 403 }),
    (error) => error.userMessage.includes("ไม่มีสิทธิ์"),
  );
});

test("managed local runtime retries transport and server failures, not rejected credentials", () => {
  assert.equal(canRecoverByStartingManagedLocalRuntime(new Error("offline")), true);
  assert.equal(
    canRecoverByStartingManagedLocalRuntime(new PairingServerResponseError(503, "unavailable")),
    true,
  );
  assert.equal(
    canRecoverByStartingManagedLocalRuntime(new PairingServerResponseError(401, "unauthorized")),
    false,
  );
});
