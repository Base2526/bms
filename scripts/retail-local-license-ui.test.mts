import assert from "node:assert/strict";
import test from "node:test";
import { localLicenseBadge, sanitizeLocalLicenseView } from "../apps/web/lib/bms/localLicenseView.ts";

test("license display separates registration, commercial status, review and connectivity", () => {
  const now = Date.now();
  const snapshot = { available: true, heartbeat: new Date(now).toISOString(), checkedAt: new Date(now).toISOString(), online: true, registered: true, registrationStatus: "ACTIVE" };
  assert.equal(localLicenseBadge(sanitizeLocalLicenseView({ ...snapshot, registered: false }, now), false).label, "Unregistered");
  assert.equal(localLicenseBadge(sanitizeLocalLicenseView({ ...snapshot, licenseCode: "LIC-example" }, now), false).label, "Status unavailable");
  assert.equal(localLicenseBadge(sanitizeLocalLicenseView({ ...snapshot, commercialStatus: "TRIAL_ACTIVE", trialDaysRemaining: 24 }, now), false).label, "Trial · 24 days left");
  assert.equal(localLicenseBadge(sanitizeLocalLicenseView({ ...snapshot, commercialStatus: "PAID_ACTIVE" }, now), false).label, "Licensed");
  assert.equal(localLicenseBadge(sanitizeLocalLicenseView({ ...snapshot, commercialStatus: "PAID_ACTIVE", reviewRequired: true }, now), false).label, "Review required");
  assert.equal(localLicenseBadge(sanitizeLocalLicenseView({ ...snapshot, registrationStatus: "PENDING" }, now), false).label, "Registration pending");
});
test("stale and offline results keep last confirmation without claiming expiry or exposing credentials", () => {
  const checkedAt = "2026-10-02T00:00:00Z";
  const view = sanitizeLocalLicenseView({ available: true, heartbeat: checkedAt, checkedAt, online: true, registered: true,
    commercialStatus: "TRIAL_ACTIVE", trialDaysRemaining: 4, trialExpiresAt: "2026-10-06T00:00:00Z", evidenceToken: "SECRET", activationCode: "SECRET", tenantId: "PRIVATE" }, Date.parse("2026-10-09T00:00:00Z"));
  assert.equal(view.online, false);
  assert.equal(view.commercialStatus, "TRIAL_ACTIVE");
  assert.equal(localLicenseBadge(view, false).label, "Status unavailable");
  assert.doesNotMatch(JSON.stringify(view), /SECRET|PRIVATE/);
});
