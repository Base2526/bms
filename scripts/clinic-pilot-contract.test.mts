import assert from "node:assert/strict";
import test from "node:test";
import { assertClinicPilotEnabled, isoDate, isoInstant, uuid } from "../apps/web/lib/bms/clinic/access";
import { validateClinicRecord } from "../apps/web/lib/bms/clinic/encounters";

test("clinic pilot denies every tenant when the flag is unset", () => {
  const before = process.env.BMS_CLINIC_PILOT_TENANTS;
  try {
    delete process.env.BMS_CLINIC_PILOT_TENANTS;
    assert.throws(() => assertClinicPilotEnabled("11111111-1111-4111-8111-111111111111"),
      /CLINIC_PILOT_DISABLED/);
    process.env.BMS_CLINIC_PILOT_TENANTS = "22222222-2222-4222-8222-222222222222";
    assert.throws(() => assertClinicPilotEnabled("11111111-1111-4111-8111-111111111111"),
      /CLINIC_PILOT_DISABLED/);
    assert.doesNotThrow(() => assertClinicPilotEnabled("22222222-2222-4222-8222-222222222222"));
  } finally {
    if (before === undefined) delete process.env.BMS_CLINIC_PILOT_TENANTS;
    else process.env.BMS_CLINIC_PILOT_TENANTS = before;
  }
});

test("clinic input rejects ambiguous identities and local times", () => {
  assert.throws(() => uuid("HN-000001"), /INVALID_ID/);
  assert.throws(() => isoInstant("2026-11-25T09:00:00"), /INVALID_TIME/);
  assert.throws(() => isoDate("2026-02-30"), /INVALID_DATE/);
});

test("clinical record rejects unknown model/client fields and requires signed minimum", () => {
  assert.throws(() => validateClinicRecord({ diagnosis: "test", patientId: "other" }, false),
    /INVALID_CLINICAL_FIELD/);
  assert.throws(() => validateClinicRecord({ diagnosis: "test" }, true),
    /CLINICAL_RECORD_INCOMPLETE/);
  assert.deepEqual(validateClinicRecord({ chiefComplaint: "symptom", examination: "exam",
    diagnosis: "diagnosis", treatmentPlan: "plan" }, true),
  { chiefComplaint: "symptom", examination: "exam", diagnosis: "diagnosis", treatmentPlan: "plan" });
});
