import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateMaterial,
  materialCount,
  materialSources,
  materialWindow,
} from "../apps/web/lib/bms/operationMaterialPolicy";
test("material planning windows are inclusive seven days; quantities remain integer base units", () => {
  assert.deepEqual(materialWindow("2026-01-01", "2026-01-07"), {
    from: "2026-01-01",
    to: "2026-01-07",
  });
  for (const to of ["2026-01-08", "2025-12-31", "invalid"])
    assert.throws(() => materialWindow("2026-01-01", to));
  for (const n of [0, -1, 1.2, NaN, Infinity, 2147483648, "2"])
    assert.throws(() => materialCount(n));
  assert.equal(materialCount(0, true), 0);
});
test("allocation has deterministic priority/due/id and never duplicates available stock", () => {
  const ds = [
    { productionId: "b", priority: 2, dueAt: "2026-01-01", qty: 10 },
    { productionId: "a", priority: 1, dueAt: "2026-01-02", qty: 8 },
  ];
  const a = allocateMaterial(ds, 12);
  assert.deepEqual(
    a.map((x) => x.allocated),
    [8, 4],
  );
  assert.deepEqual(allocateMaterial([...ds].reverse(), 12), a);
  assert.ok(
    allocateMaterial(ds, null).every(
      (x) => x.allocated === null && x.shortage === null,
    ),
  );
});
test("explicit sources reject duplicates, malformed IDs and oversized selection", () => {
  const x = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", priority: 2 };
  assert.deepEqual(materialSources([x]), [x]);
  for (const v of [
    null,
    [],
    [x, x],
    [{ ...x, priority: 4 }],
    [{ ...x, id: "bad" }],
    Array(101).fill(x),
  ])
    assert.throws(() => materialSources(v));
});
