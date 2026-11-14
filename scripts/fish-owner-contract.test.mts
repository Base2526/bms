import assert from "node:assert/strict";
import test from "node:test";
import {
  createFishDeliveryPlan, FishOwnerError, saveFishStorageCount,
} from "../apps/web/lib/bms/fishOwnerOperations.ts";
import { allocateFishCostByRevenue, fishAllocationWeights } from "../apps/web/lib/bms/fishOwnerNet.ts";

const tenant = "00000000-0000-0000-0000-000000000001";
const actor = "00000000-0000-0000-0000-000000000002";
const customer = "00000000-0000-0000-0000-000000000003";
const location = "00000000-0000-0000-0000-000000000004";
const lot = "00000000-0000-0000-0000-000000000005";

test("physical placement refuses missing or duplicate grams before any database write", async () => {
  const base = { lotId: lot, expectedLotGrams: 1250, expectedVersion: null };
  await assert.rejects(
    saveFishStorageCount(tenant, actor, { ...base, zones: [{ zone: "READY", grams: 1000 }] }),
    (error: unknown) => error instanceof FishOwnerError && error.code === "WEIGHT_MISMATCH",
  );
  await assert.rejects(
    saveFishStorageCount(tenant, actor, { ...base, zones: [
      { zone: "READY", grams: 1250 }, { zone: "READY", grams: 0 },
    ] }),
    (error: unknown) => error instanceof FishOwnerError && error.code === "INVALID_INPUT",
  );
});

test("fish delivery commitment rejects duplicate fish and impossible dates before writing", async () => {
  const base = { customerId: customer, locationId: location, requestKey: "fish-owner-contract-1",
    lines: [{ sku: "FISH-1", size: "M", agreedGrams: 1250 }] };
  await assert.rejects(
    createFishDeliveryPlan(tenant, actor, { ...base, dueOn: "2026-02-30" }),
    (error: unknown) => error instanceof FishOwnerError && error.code === "INVALID_DATE",
  );
  await assert.rejects(
    createFishDeliveryPlan(tenant, actor, { ...base, lines: [...base.lines, ...base.lines] }),
    (error: unknown) => error instanceof FishOwnerError && error.code === "INVALID_LINES",
  );
  await assert.rejects(
    createFishDeliveryPlan(tenant, actor, { ...base, lines: [{ ...base.lines[0], agreedGrams: 0 }] }),
    (error: unknown) => error instanceof FishOwnerError && error.code === "INVALID_LINES",
  );
});

test("revenue-share allocation conserves satang across fish and customer groups", () => {
  const result = allocateFishCostByRevenue([1000n, 2000n], 700n, 6000n);
  assert.equal(result.dayPool, 350n);
  assert.deepEqual(result.allocations, [117n, 233n]);
  assert.equal(result.allocations.reduce((sum, value) => sum + value, 0n), result.dayPool);
  assert.throws(() => allocateFishCostByRevenue([5000n], 700n, 4000n),
    (error: unknown) => error instanceof FishOwnerError && error.code === "NO_FISH_REVENUE");
});

test("a return keeps negative profit evidence without drawing shared expense twice", () => {
  const signedRevenue = [7000n, -3000n, 2000n];
  const grossSaleRevenue = [10000n, 0n, 2000n];
  const weights = fishAllocationWeights(grossSaleRevenue);
  assert.deepEqual(weights, [10000n, 0n, 2000n]);
  const result = allocateFishCostByRevenue(weights, 900n, 30000n);
  assert.deepEqual(result.allocations, [300n, 0n, 60n]);
  assert.equal(result.dayPool, 360n);
  assert.equal(signedRevenue[1], -3000n);
});
