import assert from "node:assert/strict";
import test from "node:test";
import {
  requisitionProgress,
  validRequisitionQuantity,
  validRequisitionPurchaseCosts,
  validRequisitionDate,
} from "../apps/web/lib/bms/branchRequisitionMath.ts";

test("receipts, drafts and transit cover demand without counting damage as delivered", () => {
  assert.deepEqual(requisitionProgress(20, 5, 5, 4, 1), {
    remaining: 6,
    status: "EXCEPTION",
  });
  assert.deepEqual(requisitionProgress(20, 0, 0, 20, 0), {
    remaining: 0,
    status: "RECEIVED",
  });
  assert.deepEqual(requisitionProgress(20, 0, 0, 0, 0), {
    remaining: 20,
    status: "UNALLOCATED",
  });
  assert.equal(requisitionProgress(20, 10, 0, 0, 0).status, "ALLOCATED");
  assert.equal(requisitionProgress(20, 0, 10, 0, 0).status, "IN_TRANSIT");
  assert.equal(requisitionProgress(20, 0, 0, 10, 0).status, "PARTIAL");
  assert.equal(requisitionProgress(0, 0, 0, 0, 0).status, "UNALLOCATED");
});
test("need-by filters and drafts reject impossible dates without relying on DB casts", () => {
  for (const date of [
    "2026-02-30",
    "2026-13-01",
    "0000-01-01",
    "bad",
    "2026-10-23T00:00:00Z",
  ])
    assert.equal(validRequisitionDate(date), false);
  for (const date of ["2024-02-29", "2026-10-23"])
    assert.equal(validRequisitionDate(date), true);
});
test("base quantities reject fractional, negative, coerced and non-finite values", () => {
  for (const x of [0, -1, 0.1, NaN, Infinity, "2", null, 1_000_001])
    assert.equal(validRequisitionQuantity(x), false);
  for (const x of [1, 20, 1_000_000])
    assert.equal(validRequisitionQuantity(x), true);
});

test("PO costs preserve cents and stay within the persisted NUMERIC(12,2) total", () => {
  for (const unitCost of [
    1.005,
    -1,
    NaN,
    Infinity,
    null,
    undefined,
    1_000_001,
  ]) {
    assert.equal(validRequisitionPurchaseCosts([{ qty: 1, unitCost }]), false);
  }
  assert.equal(
    validRequisitionPurchaseCosts([
      { qty: 3, unitCost: 0.29 },
      { qty: 1, unitCost: 0 },
    ]),
    true,
  );
  assert.equal(
    validRequisitionPurchaseCosts([{ qty: 1_000_000, unitCost: 1_000_000 }]),
    false,
  );
  const atLimit = [
    { qty: 999_999, unitCost: 10_000 },
    { qty: 1, unitCost: 9_999.99 },
  ];
  assert.equal(validRequisitionPurchaseCosts(atLimit), true);
  assert.equal(
    validRequisitionPurchaseCosts([...atLimit, { qty: 1, unitCost: 0.01 }]),
    false,
  );
});
