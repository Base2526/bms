import assert from "node:assert/strict";
import test from "node:test";
import {
  operationWeek,
  wasteValue,
  IMPROVEMENT_PERMISSIONS,
} from "../apps/web/lib/bms/operationImprovementPolicy.ts";
test("weekly periods preserve seven calendar days across month/year/leap boundaries", () => {
  assert.deepEqual(operationWeek("2028-02-27"), {
    from: "2028-02-27",
    to: "2028-03-04",
  });
  assert.deepEqual(operationWeek("2026-12-29"), {
    from: "2026-12-29",
    to: "2027-01-04",
  });
  for (const x of [
    "2026-02-29",
    "0000-01-01",
    "2026-10-24T00:00:00Z",
    "9999-12-31",
    null,
  ])
    assert.throws(() => operationWeek(x));
});
test("waste totals preserve exact decimals, distinguish unknown from zero and refuse malformed evidence", () => {
  assert.deepEqual(
    wasteValue([{ amount: "0.100001" }, { amount: "999999999999999.999999" }]),
    {
      known: "1000000000000000.100000",
      unknown: 0,
      total: "1000000000000000.100000",
    },
  );
  assert.deepEqual(wasteValue([{ amount: null }, { amount: "0" }]), {
    known: "0.000000",
    unknown: 1,
    total: null,
  });
  assert.deepEqual(wasteValue([]), {
    known: "0.000000",
    unknown: 0,
    total: "0.000000",
  });
  for (const amount of ["-1", "NaN", "1e9", "1.0000001", ""])
    assert.throws(() => wasteValue([{ amount }]));
});
test("acknowledgement does not grant assessment or permission to close an issue", () => {
  assert.equal(
    IMPROVEMENT_PERMISSIONS.ACK_STANDARD,
    "operations.checklist.view",
  );
  assert.equal(
    IMPROVEMENT_PERMISSIONS.ASSESS_STANDARD,
    "operations.standard.assess",
  );
  assert.equal(
    IMPROVEMENT_PERMISSIONS.CLOSE_ISSUE,
    "operations.checklist.review",
  );
  assert.equal(
    IMPROVEMENT_PERMISSIONS.CONFIRM_WEEK,
    "operations.summary.review",
  );
});
