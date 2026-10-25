import assert from "node:assert/strict";
import test from "node:test";
import {
  checklistItems,
  evaluateChecklistResult,
  editableChecklist,
  checklistReportDates,
} from "../apps/web/lib/bms/operationChecklistPolicy.ts";
const item = (extra: any = {}) =>
  checklistItems([
    {
      key: "cold",
      label: "Cold storage",
      type: "TEMPERATURE",
      required: true,
      photoRequired: false,
      allowNa: false,
      min: 0,
      max: 5,
      unit: "C",
      choices: [],
      instruction: "Check equipment",
      ...extra,
    },
  ])[0];
test("Release C report dates are real calendar days, ordered and at most 93 inclusive days", () => {
  assert.deepEqual(checklistReportDates("2026-01-01", "2026-04-03"), {
    from: "2026-01-01",
    to: "2026-04-03",
  });
  assert.deepEqual(checklistReportDates("2024-02-29", "2024-02-29"), {
    from: "2024-02-29",
    to: "2024-02-29",
  });
  for (const [from, to] of [
    ["2026-02-29", "2026-03-01"],
    ["2026-01-01", "2026-04-04"],
    ["2026-02-01", "2026-01-31"],
    ["2026-10-24T00:00:00Z", "2026-10-25"],
    ["invalid", "invalid"],
  ])
    assert.throws(() => checklistReportDates(from, to), /INVALID_INPUT/);
});
test("measurement zero and both limits are valid; missing and nonnumeric values are rejected", () => {
  for (const value of [0, 5])
    assert.equal(evaluateChecklistResult(item(), value, "", []), "PASS");
  for (const value of [-0.1, 5.1])
    assert.equal(evaluateChecklistResult(item(), value, "", []), "FAIL");
  for (const value of [null, undefined, "", false, "3", NaN, Infinity])
    assert.throws(
      () => evaluateChecklistResult(item(), value, "", []),
      /INVALID_INPUT/,
    );
  assert.equal(
    evaluateChecklistResult(item({ min: null, max: null }), 8, "", []),
    "RECORDED",
  );
});
test("N/A requires explicit permission and a reason; required photos are checked", () => {
  assert.throws(
    () => evaluateChecklistResult(item(), "NA", "Not applicable", []),
    /REASON_REQUIRED/,
  );
  assert.throws(
    () => evaluateChecklistResult(item({ allowNa: true }), "NA", "", []),
    /REASON_REQUIRED/,
  );
  assert.equal(
    evaluateChecklistResult(
      item({ allowNa: true }),
      "NA",
      "Equipment unavailable",
      [],
    ),
    "NA",
  );
  assert.throws(
    () => evaluateChecklistResult(item({ photoRequired: true }), 3, "", []),
    /EVIDENCE_REQUIRED/,
  );
  assert.equal(
    evaluateChecklistResult(item({ photoRequired: true }), 3, "", [1]),
    "PASS",
  );
});
test("template boundary rejects duplicate keys, invalid limits and unsupported answers", () => {
  assert.throws(() => checklistItems([item(), item()]), /INVALID_INPUT/);
  for (const fields of [
    { min: 8, max: 2 },
    { min: "0" },
    { type: "SQL" },
    { required: "true" },
    { key: "../x" },
  ])
    assert.throws(() => item(fields), /INVALID_INPUT/);
  const choice = item({
    type: "CHOICE",
    min: null,
    max: null,
    choices: ["Done", "Needs work"],
  });
  assert.throws(
    () => evaluateChecklistResult(choice, "Other", "", []),
    /INVALID_INPUT/,
  );
  assert.equal(evaluateChecklistResult(choice, "Done", "", []), "RECORDED");
});
test("submission and approval freeze answers until rejected", () => {
  for (const status of ["SUBMITTED", "APPROVED", "VOID", "anything"])
    assert.throws(() => editableChecklist(status), /INVALID_STATE/);
  for (const status of ["OPEN", "IN_PROGRESS", "REJECTED"])
    assert.doesNotThrow(() => editableChecklist(status));
});
