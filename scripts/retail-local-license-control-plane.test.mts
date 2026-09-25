import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  deriveRetailLocalCommercialState,
  RETAIL_LOCAL_TRIAL_DAYS,
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
  const trialMigration = readFileSync(new URL("../db/migrations/10.17__bms_retail_local_trial_lifecycle.sql", import.meta.url), "utf8");
  const service = readFileSync(new URL("../apps/web/lib/bms/retailLocalLicensing.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../apps/web/app/api/bms/retail-local/license-evidence/route.ts", import.meta.url), "utf8");
  assert.match(migration, /Append-only signed Retail Local license evidence/);
  assert.match(migration, /Human back-office review queue[\s\S]*never disables an installed shop/);
  assert.match(service, /crypto\.verify/);
  assert.match(service, /EVENT_CHAIN_CONFLICT/);
  assert.match(service, /ACTIVE_INSTALLATION_LIMIT/);
  assert.match(trialMigration, /expiry never disables local business operations/i);
  assert.match(trialMigration, /Commercial follow-up state only; never an entitlement check/i);
  assert.match(route, /authorize|Bearer/);
  assert.doesNotMatch(service, /bms_orders|bms_inventory|bms_payments|read.only|kill.switch/i);
});

test("30-day trials derive customer-friendly commercial follow-up states without a runtime lease", () => {
  assert.equal(RETAIL_LOCAL_TRIAL_DAYS, 30);
  const now = new Date("2026-09-25T00:00:00.000Z");
  assert.deepEqual(
    deriveRetailLocalCommercialState({
      licenseType: "TRIAL",
      commercialStatus: "TRIAL_ACTIVE",
      trialExpiresAt: "2026-10-25T00:00:00.000Z",
    }, now),
    { status: "TRIAL_ACTIVE", trialDaysRemaining: 30 },
  );
  assert.deepEqual(
    deriveRetailLocalCommercialState({
      licenseType: "TRIAL",
      commercialStatus: "TRIAL_ACTIVE",
      trialExpiresAt: "2026-10-02T00:00:00.000Z",
    }, now),
    { status: "TRIAL_EXPIRING", trialDaysRemaining: 7 },
  );
  assert.deepEqual(
    deriveRetailLocalCommercialState({
      licenseType: "TRIAL",
      commercialStatus: "TRIAL_ACTIVE",
      trialExpiresAt: "2026-09-24T23:59:59.000Z",
    }, now),
    { status: "TRIAL_EXPIRED", trialDaysRemaining: 0 },
  );
  assert.deepEqual(
    deriveRetailLocalCommercialState({
      licenseType: "PAID",
      commercialStatus: "PAID_ACTIVE",
    }, now),
    { status: "PAID_ACTIVE", trialDaysRemaining: null },
  );
  assert.deepEqual(deriveRetailLocalCommercialState({
    licenseType: "TRIAL",
    commercialStatus: "PAYMENT_REVIEW",
    trialExpiresAt: "2026-10-25T00:00:00.000Z",
  }, now), { status: "PAYMENT_REVIEW", trialDaysRemaining: 30 });
  assert.equal(deriveRetailLocalCommercialState({
    licenseType: "PAID",
    commercialStatus: "CANCELLED",
  }, now).status, "CANCELLED");
});

test("trial issuance and lifecycle changes stay platform-admin-only and explicitly confirmed", () => {
  const createRoute = readFileSync(new URL("../apps/web/app/api/admin/retail-local/licenses/route.ts", import.meta.url), "utf8");
  const commercialRoute = readFileSync(new URL("../apps/web/app/api/admin/retail-local/licenses/[id]/commercial/route.ts", import.meta.url), "utf8");
  const trialMigration = readFileSync(new URL("../db/migrations/10.17__bms_retail_local_trial_lifecycle.sql", import.meta.url), "utf8");
  assert.match(createRoute, /authorizePlatformAdminRoute/);
  assert.match(createRoute, /licenseType: body\?\.licenseType/);
  assert.match(commercialRoute, /authorizePlatformAdminRoute/);
  assert.match(commercialRoute, /CONVERT-RETAIL-LOCAL-TO-PAID/);
  assert.match(commercialRoute, /EXTEND-RETAIL-LOCAL-TRIAL/);
  assert.match(commercialRoute, /reason/);
  assert.match(trialMigration, /bms_retail_local_license_commercial_events/);
  assert.match(trialMigration, /Append-only audit of human commercial actions/);
});
