import assert from "node:assert/strict";
import test from "node:test";
import {
  productionDate,
  productionQuantity,
  productionIngredients,
  scaleProductionIngredients,
} from "../apps/web/lib/bms/operationProductionPolicy.ts";
test("production quantities refuse fractions, strings, zero and overflow", () => {
  for (const x of [0, -1, 1.1, "1", NaN, 2147483648])
    assert.throws(() => productionQuantity(x));
  assert.equal(productionQuantity(2147483647), 2147483647);
});
test("production scaling preserves integer base units, rejects fractional expansion and duplicate ingredients", () => {
  assert.deepEqual(
    scaleProductionIngredients([{ sku: "A", size: "BASE", qty: 3 }], 2, 4),
    [{ sku: "A", size: "BASE", qty: 6 }],
  );
  assert.throws(() =>
    scaleProductionIngredients([{ sku: "A", size: "BASE", qty: 3 }], 2, 1),
  );
  assert.throws(() =>
    productionIngredients([
      { sku: "A", size: "B", qty: 1 },
      { sku: "A", size: "B", qty: 2 },
    ]),
  );
  assert.throws(() =>
    scaleProductionIngredients(
      [{ sku: "A", size: "BASE", qty: 2147483647 }],
      1,
      2,
    ),
  );
});
test("production date is a real calendar date, not normalized invalid input or an instant", () => {
  assert.equal(productionDate("2028-02-29"), "2028-02-29");
  for (const x of [
    "0000-01-01",
    "2026-02-29",
    "2026-02-30",
    "2026-13-01",
    "2026-01-01T00:00:00Z",
    "",
  ])
    assert.throws(() => productionDate(x));
});
