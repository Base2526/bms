import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RetailLocalLicenseError,
  verifyRetailLocalLicenseEnvelope,
} from "../apps/web/lib/bms/retailLocalLicensing.ts";

function signedEnvelope() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const der = publicKey.export({ type: "spki", format: "der" });
  const rawPublicKey = der.subarray(der.length - 32);
  const event = {
    formatVersion: 1 as const,
    eventId: "11111111-1111-4111-8111-111111111111",
    eventType: "INSTALLATION_REGISTERED",
    licenseId: "LIC-0123456789ABCDEF0123",
    installationId: "22222222-2222-4222-8222-222222222222",
    tenantId: "33333333-3333-4333-8333-333333333333",
    posDeviceId: "44444444-4444-4444-8444-444444444444",
    platformTarget: "ubuntu-24.04-lts-x64",
    releaseVersion: "1.0.0",
    agentVersion: "0.4.0",
    occurredAt: "2026-09-25T06:00:00Z",
    sequence: 1,
    deviceKeyThumbprint: crypto.createHash("sha256").update(rawPublicKey).digest("hex"),
  };
  const bytes = Buffer.from(JSON.stringify(event));
  return {
    formatVersion: 1 as const,
    event,
    eventHash: crypto.createHash("sha256").update(bytes).digest("hex"),
    devicePublicKey: rawPublicKey.toString("base64url"),
    signature: crypto.sign(null, bytes, privateKey).toString("base64url"),
  };
}

test("license control plane verifies the agent Ed25519 wire format", () => {
  const envelope = signedEnvelope();
  const verified = verifyRetailLocalLicenseEnvelope(envelope);
  assert.equal(verified.event.installationId, envelope.event.installationId);
  assert.equal(verified.eventHash, envelope.eventHash);
});

test("license control plane rejects tampering and unknown fields", () => {
  const envelope = signedEnvelope();
  assert.throws(
    () => verifyRetailLocalLicenseEnvelope({ ...envelope, event: { ...envelope.event, releaseVersion: "9.9.9" } }),
    RetailLocalLicenseError
  );
  assert.throws(
    () => verifyRetailLocalLicenseEnvelope({ ...envelope, secret: "must-not-pass" }),
    /field ไม่รองรับ/
  );
});

test("license schema is append-only evidence and never a runtime entitlement gate", () => {
  const migration = readFileSync(new URL("../db/migrations/10.16__bms_retail_local_license_control_plane.sql", import.meta.url), "utf8");
  const service = readFileSync(new URL("../apps/web/lib/bms/retailLocalLicensing.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../apps/web/app/api/bms/retail-local/license-evidence/route.ts", import.meta.url), "utf8");
  assert.match(migration, /Append-only signed Retail Local license evidence/);
  assert.match(migration, /Human back-office review queue[\s\S]*never disables an installed shop/);
  assert.match(service, /crypto\.verify/);
  assert.match(service, /EVENT_CHAIN_CONFLICT/);
  assert.match(service, /ACTIVE_INSTALLATION_LIMIT/);
  assert.match(route, /authorize|Bearer/);
  assert.doesNotMatch(service, /bms_orders|bms_inventory|bms_payments|read.only|kill.switch/i);
});
