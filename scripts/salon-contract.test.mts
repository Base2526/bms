import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { salonStatusTransitionAllowed, validateSalonBoardRange, validateSalonInterval } from "../apps/web/lib/bms/salon.ts";

test("salon lifecycle has explicit terminal states", () => {
  assert.equal(salonStatusTransitionAllowed("BOOKED", "CONFIRMED"), true);
  assert.equal(salonStatusTransitionAllowed("BOOKED", "NO_SHOW"), true);
  assert.equal(salonStatusTransitionAllowed("CONFIRMED", "COMPLETED"), false);
  assert.equal(salonStatusTransitionAllowed("IN_SERVICE", "COMPLETED"), true);
  assert.equal(salonStatusTransitionAllowed("COMPLETED", "BOOKED"), false);
  assert.equal(salonStatusTransitionAllowed("CANCELLED", "CONFIRMED"), false);
});

test("salon time intervals reject malformed, reversed and unbounded bookings", () => {
  assert.equal(validateSalonInterval("2026-10-22T09:00:00+07:00", "2026-10-22T10:00:00+07:00"), null);
  assert.match(validateSalonInterval("bad", "2026-10-22T10:00:00+07:00") ?? "", /ไม่ถูกต้อง/);
  assert.match(validateSalonInterval("2026-10-22T10:00:00+07:00", "2026-10-22T09:00:00+07:00") ?? "", /หลัง/);
  assert.match(validateSalonInterval("2026-10-22T09:00:00+07:00", "2026-10-23T09:00:00+07:00") ?? "", /12 ชั่วโมง/);
});

test("salon board accepts normal planning ranges but rejects unbounded reads", () => {
  assert.equal(validateSalonBoardRange("2026-10-22T00:00:00+07:00", "2026-10-29T00:00:00+07:00"), null);
  assert.match(validateSalonBoardRange("2026-10-22T00:00:00+07:00", "2027-01-22T00:00:00+07:00") ?? "", /62 วัน/);
});

test("10.87 migration keeps tenant isolation, auditability and append-only package use", () => {
  const migration = readFileSync(path.resolve(import.meta.dirname, "../db/migrations/10.87__bms_salon_operations.sql"), "utf8");
  for (const table of [
    "bms_salon_service_settings", "bms_salon_resources", "bms_salon_appointments",
    "bms_salon_appointment_services", "bms_salon_client_profiles", "bms_salon_package_plans",
    "bms_salon_customer_packages", "bms_salon_package_ledger",
  ]) assert.match(migration, new RegExp(table));
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /current_setting\(''bms\.tenant_id''/);
  assert.match(migration, /UNIQUE \(tenant_id, appointment_service_id\)/);
  assert.match(migration, /REVOKE UPDATE, DELETE ON bms_salon_package_ledger/);
  assert.match(migration, /salon\.client_notes\.manage/);
  assert.match(migration, /salon\.package\.manage/);
});
