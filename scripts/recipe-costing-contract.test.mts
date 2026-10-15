import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "../apps/web/node_modules/typescript/lib/typescript.js";
import * as costing from "../apps/web/lib/bms/recipeCosting.ts";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const zero = { quantity: 0, rate: 0, source: "No usage, staff confirmed" };
const assumptions = { labor: { quantity: 30, rate: 80, source: "Roster estimate" },
  electricity: { quantity: 0.5, rate: 4.5, source: "Meter estimate" }, gas: { quantity: 0.2, rate: 30, source: "Cylinder estimate" } };
const ingredients = [{ sku: "RICE", size: "GRAM", qty: 100, unitCost: "0.20" }, { sku: "EGG", size: "PIECE", qty: 2, unitCost: "5.00" }];
const calculate = (patch: any = {}) => costing.calculateRecipeCostEstimate({ outputQty: 2, assumptions, ingredients, ...patch });

test("ingredient + person-minute labor + kWh + kg estimates use batch yield, not sales quantity", () => {
  const result = calculate();
  assert.equal(result.ingredientBatchCost, 30); assert.equal(result.totalBatchCost, 78.25);
  assert.equal(result.totalUnitCost, 39.13); assert.equal(result.knownBatchCost, 78.25);
  assert.equal(result.status, "COMPLETE"); assert.equal(result.scope, "WHOLE_BATCH_INCLUDING_SUBRECIPES");
  assert.deepEqual(result.overhead.map(r => r.batchCost), [40, 2.25, 6]);
  assert.equal(result.overhead[0].source, "Roster estimate"); assert.equal(result.ingredients[0].source, "CATALOG_CURRENT");
});

test("missing ingredient evidence leaves totals unknown and exposes known subtotal", () => {
  const result = calculate({ ingredients: [{ ...ingredients[0], unitCost: null }, ingredients[1]] });
  assert.equal(result.status, "INCOMPLETE"); assert.equal(result.ingredientBatchCost, null);
  assert.equal(result.totalBatchCost, null); assert.equal(result.totalUnitCost, null);
  assert.equal(result.knownBatchCost, 58.25); assert.equal(result.missingIngredientCount, 1);
  assert.equal(result.ingredients[0].batchCost, null); assert.equal(result.ingredients[0].source, "MISSING");
});

test("each unknown overhead blocks totals; explicit zero with provenance is known", () => {
  for (const key of ["labor", "electricity", "gas"]) {
    const result = calculate({ assumptions: { ...assumptions, [key]: null } });
    assert.equal(result.totalBatchCost, null); assert.equal(result.totalUnitCost, null);
    assert.equal(result.overhead.find(r => r.category === key)?.batchCost, null);
  }
  const result = calculate({ assumptions: { labor: zero, electricity: zero, gas: zero }, ingredients: [{ ...ingredients[0], unitCost: "0.00" }] });
  assert.equal(result.totalBatchCost, 0); assert.equal(result.status, "COMPLETE");
  const absent = calculate({ assumptions: null }); assert.equal(absent.knownBatchCost, 30); assert.equal(absent.totalBatchCost, null);
});

test("invalid catalog values never masquerade as free ingredients", () => {
  for (const unitCost of [-1, NaN, Infinity, "", " ", true, "-0.01", "1e2", {}, "0.0000001", "10000000000"]) {
    const result = calculate({ ingredients: [{ ...ingredients[0], unitCost }] });
    assert.equal(result.ingredients[0].source, "INVALID_CATALOG"); assert.equal(result.totalBatchCost, null);
  }
});

test("fixed-point math rounds after aggregation and yield division, never per ingredient first", () => {
  const result = calculate({ outputQty: 3, assumptions: { labor: zero, electricity: zero, gas: zero },
    ingredients: [{ sku: "A", size: "G", qty: 1, unitCost: "0.005" }, { sku: "B", size: "G", qty: 1, unitCost: "0.005" }] });
  assert.deepEqual(result.ingredients.map(r => r.batchCost), [0.01, 0.01]);
  assert.equal(result.totalBatchCost, 0.01); assert.equal(result.totalUnitCost, 0);
  const labor = calculate({ outputQty: 1, assumptions: { labor: { quantity: 1, rate: 0.3, source: "Exact half cent" }, electricity: zero, gas: zero },
    ingredients: [{ ...ingredients[0], unitCost: "0" }] });
  assert.equal(labor.totalBatchCost, 0.01);
});

test("assumptions reject malformed shapes, hidden keys, coerced numbers and excessive precision", () => {
  for (const value of [[], "x", 2, { rent: zero }, { labor: [] }, { labor: { ...zero, unexpected: 1 } },
    ...[-1, NaN, Infinity, 1_000_001, 0.0000001, "2", null, true].map(quantity => ({ labor: { ...zero, quantity } })),
    ...[-1, NaN, Infinity, "2", 0.0000001].map(rate => ({ gas: { ...zero, rate } })),
    ...["", " ", "x".repeat(501), null, 2].map(source => ({ electricity: { ...zero, source } }))]) {
    assert.throws(() => costing.normalizeRecipeCostAssumptions(value));
  }
  assert.deepEqual(costing.normalizeRecipeCostAssumptions({ gas: { quantity: 0.000001, rate: 1000000, source: " x " } }),
    { labor: null, electricity: null, gas: { quantity: 0.000001, rate: 1000000, source: "x" } });
});

test("calculator refuses malformed/oversized BOM and money overflow without mutating inputs", () => {
  const snapshot = structuredClone({ assumptions, ingredients }); calculate();
  assert.deepEqual({ assumptions, ingredients }, snapshot);
  for (const outputQty of [0, 1.5, NaN, 2147483648]) assert.throws(() => calculate({ outputQty }));
  for (const list of [[], Array(201).fill(ingredients[0]), [{ ...ingredients[0], qty: 1.5 }], [{ ...ingredients[0], qty: 0 }]]) assert.throws(() => calculate({ ingredients: list }));
  assert.throws(() => calculate({ ingredients: [{ ...ingredients[0], qty: 2147483647, unitCost: "9999999999.99" }] }), /safe money/);
});

function load(file: string, dependency: (name: string) => any) {
  const exports: any = {};
  new Function("require", "exports", ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(dependency, exports);
  return exports;
}
const recipeId = "00000000-0000-4000-8000-000000000001";

test("estimate service scopes one consistent read and labels current catalog observation; foreign/missing is null", async () => {
  const calls: any[] = []; let rows: any[] = [{ id: recipeId, version: 4, output_qty: 2, cost_assumptions: assumptions, ingredients, calculated_at: new Date("2026-10-15T00:00:00Z") }];
  const service = load("apps/web/lib/bms/recipeCostEstimates.ts", name => {
    if (name === "./recipeCosting") return costing;
    if (name === "@/lib/db") return { query: async (sql: string, params: any[]) => { calls.push({ sql, params }); return { rows }; } };
    throw new Error(name);
  });
  const result = await service.getRecipeCostEstimate("tenant-a", recipeId);
  assert.equal(result.recipeVersion, 4); assert.equal(result.calculatedAt, "2026-10-15T00:00:00.000Z");
  assert.equal(result.totalBatchCost, 78.25); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ["tenant-a", recipeId]);
  for (const predicate of [/r.tenant_id=\$1 AND r.id=\$2/, /p.tenant_id=i.tenant_id/, /i.tenant_id=r.tenant_id/, /statement_timestamp\(\)/]) assert.match(calls[0].sql, predicate);
  rows = [{ ...rows[0], ingredients: [{ ...ingredients[0], unitCost: "0.40" }, ingredients[1]] }];
  assert.equal((await service.getRecipeCostEstimate("tenant-a", recipeId)).totalBatchCost, 98.25);
  assert.equal(result.totalBatchCost, 78.25); // Previous response is not mutated.
  rows = []; assert.equal(await service.getRecipeCostEstimate("foreign", recipeId), null);
  const count = calls.length; await assert.rejects(service.getRecipeCostEstimate("tenant-a", "bad id")); assert.equal(calls.length, count);
});

test("cost GraphQL query enforces product.view, server tenant and bad ids before service invocation", async () => {
  let allowed = false; const calls: any[] = [];
  class InputError extends Error { extensions: any; constructor(message: string, options: any) { super(message); this.extensions = options.extensions; } }
  const adapter = load("apps/web/graphql/bmsStockCapabilities.ts", name => {
    if (name === "graphql/error") return { GraphQLError: InputError };
    if (name === "@/lib/bms/permissions") return { requirePermission: async (_: any, permission: string) => { assert.equal(permission, "product.view"); if (!allowed) throw new Error("FORBIDDEN"); } };
    if (name === "@/lib/bms/tenant") return { getTenantId: () => "server-tenant" };
    if (name === "@/lib/bms/recipeCostEstimates") return { getRecipeCostEstimate: async (...args: any[]) => { calls.push(args); return null; } };
    return {};
  }).bmsStockCapabilityResolvers.Query;
  const run = (id = recipeId) => adapter.bmsRecipeCostEstimate(null, { recipeId: id, tenantId: "forged" }, {});
  await assert.rejects(run(), /FORBIDDEN/); assert.equal(calls.length, 0);
  allowed = true; assert.equal(await run(), null); assert.deepEqual(calls, [["server-tenant", recipeId]]);
  await assert.rejects(run("bad"), (error: any) => error.extensions.code === "BAD_USER_INPUT"); assert.equal(calls.length, 1);
});

test("costing migration is additive; estimates cannot become bill/stock/report authority", () => {
  const sql = read("db/migrations/10.63__bms_recipe_cost_assumptions.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS cost_assumptions JSONB/); assert.match(sql, /IF NOT EXISTS.*pg_constraint/);
  assert.match(sql, /conrelid='bms_product_recipes'::regclass/); assert.match(sql, /ROLLBACK/);
  assert.doesNotMatch(sql, /CREATE TABLE|CREATE TRIGGER|UPDATE bms_|DELETE FROM bms_/i);
  for (const file of ["orders", "pos", "restaurantPos", "stockConsumption", "restaurantItemSnapshots", "productConfiguration"]) {
    assert.doesNotMatch(read(`apps/web/lib/bms/${file}.ts`), /recipeCosting|recipeCostEstimates|cost_assumptions/);
  }
  const service = read("apps/web/lib/bms/recipeCostEstimates.ts");
  assert.doesNotMatch(service, /INSERT INTO|UPDATE bms_|DELETE FROM/);
  const schema = read("apps/web/graphql/typeDefs.ts");
  assert.match(schema, /bmsRecipeCostEstimate\(recipeId: ID!\): BmsRecipeCostEstimate/);
});
