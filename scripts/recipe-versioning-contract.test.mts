import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "../apps/web/node_modules/typescript/lib/typescript.js";
import * as definition from "../apps/web/lib/bms/recipeDefinition.ts";
import * as composition from "../apps/web/lib/bms/recipeComposition.ts";
import * as costing from "../apps/web/lib/bms/recipeCosting.ts";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const ingredient = { sku: "RICE", size: "GRAM", qty: 100 };
const original = () => ({ id: "recipe-1", tenant_id: "tenant-a", product_sku: "MENU", size: "PLATE", version: 1,
  output_qty: 1, active: true, items: [{ ...ingredient }], direct_items: null as null | typeof ingredient[],
  sop_steps: [] as string[], subrecipes: [] as composition.RecipeReference[], cost_assumptions: null as costing.RecipeCostAssumptions | null });

// Execute the real service with a transactional fake. This proves orchestration, not PostgreSQL
// constraints, row locking, RLS, or triggers; those require the separate DB contract.
function harness() {
  const state = { recipes: [original()], audits: [] as any[], productActive: true,
    failAudit: false, failReadiness: false, failItem: false, failReference: false, released: 0, acquired: 0,
    children: [] as any[] };
  const calls: { sql: string; params: any[] }[] = [];
  let backup: { recipes: typeof state.recipes; audits: any[] } | null = null;
  const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
  const client = {
    release() { state.released++; },
    async query(sql: string, params: any[] = []) {
      calls.push({ sql, params });
      if (sql === "BEGIN") {
        backup = structuredClone({ recipes: state.recipes, audits: state.audits });
        return result();
      }
      if (sql === "ROLLBACK") {
        if (backup) Object.assign(state, backup);
        return result();
      }
      if (sql === "COMMIT") { backup = null; return result(); }
      if (sql.includes("SELECT active FROM bms_products")) {
        return result(params[0] === "tenant-a" && params[1] === "MENU" ? [{ active: state.productActive }] : []);
      }
      if (sql.includes("FROM bms_product_recipes") && /FOR (?:NO KEY )?UPDATE/.test(sql)) {
        return result(state.recipes.filter(r => r.tenant_id === params[0] && r.id === params[1]));
      }
      if (sql.includes("FOR KEY SHARE OF r")) {
        return result(state.children.filter(r => r.tenant_id === params[0] && r.id === params[1]));
      }
      if (sql.includes("FROM bms_product_recipe_items")) {
        const recipe = state.recipes.find(r => r.tenant_id === params[0] && r.id === params[1]);
        return result(recipe?.items.map(i => ({ component_sku: i.sku, component_size: i.size, qty: i.qty })) ?? []);
      }
      if (sql.includes("UPDATE bms_product_recipes SET active = FALSE")) {
        for (const r of state.recipes) {
          if (r.tenant_id === params[0] && r.product_sku === params[1] && r.size === params[2] && r.id !== params[3]) r.active = false;
        }
        return result();
      }
      if (sql.includes("UPDATE bms_product_recipes SET active = $3")) {
        const r = state.recipes.find(r => r.tenant_id === params[0] && r.id === params[1]);
        assert.ok(r);
        r.active = params[2];
        return result([r]);
      }
      if (sql.includes("INSERT INTO bms_product_recipes")) {
        const [tenantId, sku, size, outputQty, active] = params;
        const version = Math.max(0, ...state.recipes.filter(r => r.tenant_id === tenantId && r.product_sku === sku && r.size === size).map(r => r.version)) + 1;
        const r = { id: `recipe-${version}`, tenant_id: tenantId, product_sku: sku, size, output_qty: outputQty, active, version,
          items: [] as typeof ingredient[], direct_items: JSON.parse(params[5]), sop_steps: JSON.parse(params[6]), subrecipes: [] as composition.RecipeReference[], cost_assumptions: JSON.parse(params[7]) };
        state.recipes.push(r);
        return result([r]);
      }
      if (sql.includes("INSERT INTO bms_product_recipe_subrecipes")) {
        if (state.failReference) throw new Error("FAKE reference constraint");
        const r = state.recipes.find(r => r.tenant_id === params[0] && r.id === params[1]);
        const child = state.children.find(r => r.tenant_id === params[0] && r.id === params[2]);
        assert.ok(r); assert.ok(child);
        r.subrecipes.push({ recipeId: child.id, qty: params[3], productSku: child.product_sku,
          size: child.size, version: child.version, outputQty: child.output_qty });
        return result();
      }
      if (sql.includes("INSERT INTO bms_product_recipe_items")) {
        if (state.failItem) throw new Error("FAKE component constraint");
        const r = state.recipes.find(r => r.tenant_id === params[0] && r.id === params[1]);
        assert.ok(r);
        r.items.push({ sku: params[2], size: params[3], qty: params[4] });
        return result();
      }
      if (sql.includes("INSERT INTO bms_product_stock_policies")) return result();
      if (sql.includes("INSERT INTO bms_audit_log")) {
        if (state.failAudit) throw new Error("FAKE audit failure");
        state.audits.push({ tenant: params[0], actor: params[1], target: params[2], meta: JSON.parse(params[3]) });
        return result();
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const exports: any = {};
  const js = ts.transpileModule(read("apps/web/lib/bms/productRecipes.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "exports", js)((name: string) => {
    if (name === "@/lib/db") return { getClient: async () => { state.acquired++; return client; },
      query: async () => { throw new Error("A recipe mutation must return its own transaction result, not query after commit"); } };
    if (name === "./tenant") return { beginTenantTx: async (c: typeof client, tenantId: string, options: any) => {
      assert.ok(tenantId); assert.equal(options.editorId, "actor"); await c.query("BEGIN");
    } };
    if (name === "./recipeDefinition") return definition;
    if (name === "./recipeComposition") return composition;
    if (name === "./recipeCosting") return costing;
    if (name === "./productConfiguration") return {
      getProductReadinessInTx: async (c: typeof client, tenantId: string, sku: string) => {
        assert.equal(c, client); assert.equal(tenantId, "tenant-a"); assert.equal(sku, "MENU");
        return {};
      },
      assertReadinessAllowsSaveOfActiveProduct: () => { if (state.failReadiness) throw new Error("FAKE readiness failure"); },
    };
    throw new Error(`Unexpected dependency: ${name}`);
  }, exports);
  const save = (patch: any = {}, tenantId = "tenant-a") => exports.upsertProductRecipe(tenantId, {
    id: "recipe-1", productSku: "MENU", size: "PLATE", outputQty: 1, items: [{ ...ingredient }], ...patch,
  }, "actor");
  return { state, calls, save };
}

test("recipe validation rejects fractional, nonnumeric and out-of-range base quantities without rounding", () => {
  for (const value of [1.5, 0, -1, NaN, Infinity, 2_147_483_648, "2", null, true]) {
    assert.throws(() => definition.normalizeRecipeDefinition({ outputQty: value as any, items: [ingredient] }));
    assert.throws(() => definition.normalizeRecipeDefinition({ outputQty: 1, items: [{ ...ingredient, qty: value as any }] }));
  }
  const valid = definition.normalizeRecipeDefinition({ outputQty: 2, items: [{ sku: " RICE ", size: " GRAM ", qty: 200 }] });
  assert.deepEqual(valid, { outputQty: 2, items: [{ ...ingredient, qty: 200 }] });
});

test("cost assumption edits append a version; no-op and legacy omission preserve evidence", async () => {
  const h = harness();
  const costAssumptions = costing.normalizeRecipeCostAssumptions({ labor: { quantity: 30, rate: 80, source: "Roster estimate 2026-10-15" } });
  const saved = await h.save({ costAssumptions });
  assert.equal(saved.version, 2); assert.deepEqual(saved.costAssumptions, costAssumptions);
  assert.equal(h.state.recipes[0].cost_assumptions, null);
  assert.equal((await h.save({ id: saved.id })).version, 2);
  assert.equal((await h.save({ id: saved.id, costAssumptions })).version, 2);
  const changedSource = structuredClone(costAssumptions); changedSource.labor!.source = "New reviewed basis";
  assert.equal((await h.save({ id: saved.id, costAssumptions: changedSource })).version, 3);
  const cleared = await h.save({ id: saved.id, costAssumptions: null });
  assert.equal(cleared.version, 4);
  assert.deepEqual(cleared.costAssumptions, { labor: null, electricity: null, gas: null });
  assert.deepEqual(h.state.recipes[1].cost_assumptions, costAssumptions);
  assert.ok(h.state.audits.every(a => !JSON.stringify(a.meta).includes("Roster estimate")));
});

test("cost-only changes roll back on audit failure; malformed assumptions fail before connection", async () => {
  const h = harness(); h.state.failAudit = true;
  await assert.rejects(h.save({ costAssumptions: { gas: { quantity: 0.5, rate: 30, source: "Cylinder estimate" } } }));
  assert.deepEqual(h.state.recipes, [original()]);
  for (const costAssumptions of [{ labor: { quantity: -1, rate: 2, source: "x" } }, { gas: { quantity: 0, rate: 0 } }, []]) {
    const invalid = harness(); await assert.rejects(invalid.save({ costAssumptions })); assert.equal(invalid.state.acquired, 0);
  }
});

test("recipe validation rejects malformed, empty and duplicate components after trimming", () => {
  for (const items of [[], null, [null], [{ ...ingredient, sku: " " }], [ingredient, { ...ingredient, sku: " RICE " }]]) {
    assert.throws(() => definition.normalizeRecipeDefinition({ outputQty: 1, items: items as any }));
  }
});

test("component order is not a recipe change; yield, size and quantity are", () => {
  const a = { outputQty: 1, items: [ingredient, { sku: "EGG", size: "PIECE", qty: 1 }] };
  assert.equal(definition.sameRecipeDefinition(a, { ...a, items: [...a.items].reverse() }), true);
  assert.equal(definition.sameRecipeDefinition(a, { ...a, outputQty: 2 }), false);
  assert.equal(definition.sameRecipeDefinition(a, { ...a, items: [{ ...ingredient, qty: 101 }, a.items[1]] }), false);
  assert.equal(definition.sameRecipeDefinition(a, { ...a, items: [{ ...ingredient, size: "KG" }, a.items[1]] }), false);
});

test("changing recipe content appends a version and retains the old header and components", async () => {
  const h = harness();
  const saved = await h.save({ items: [{ ...ingredient, qty: 125 }] });
  assert.equal(saved.id, "recipe-2"); assert.equal(saved.version, 2); assert.equal(saved.active, true);
  assert.deepEqual(h.state.recipes[0], { ...original(), active: false });
  assert.deepEqual(saved.items, [{ ...ingredient, qty: 125 }]);
  assert.equal(h.state.audits[0].target, saved.id);
  assert.equal(h.state.audits[0].actor, "actor");
  assert.equal(h.state.audits[0].meta.sourceRecipeId, "recipe-1");
  assert.equal(h.calls.at(-1)?.sql, "COMMIT"); assert.equal(h.state.released, 1);
  assert.ok(!h.calls.some(c => /DELETE FROM bms_product_recipe_items|SET\s+output_qty/i.test(c.sql)));
});

test("unchanged content keeps its id and version, including activation-only changes", async () => {
  const h = harness();
  assert.equal((await h.save()).id, "recipe-1");
  assert.equal((await h.save({ active: false })).active, false);
  assert.equal((await h.save({ active: true })).active, true);
  assert.equal(h.state.recipes.length, 1);
  assert.deepEqual(h.state.recipes[0].items, [ingredient]);
  assert.ok(!h.calls.some(c => c.sql.includes("INSERT INTO bms_product_recipe_items")));
});

test("saving a changed recipe inactive does not disable the current active recipe", async () => {
  const h = harness();
  const saved = await h.save({ outputQty: 2, active: false });
  assert.equal(saved.active, false); assert.equal(saved.version, 2);
  assert.equal(h.state.recipes[0].active, true);
});

test("creating a recipe allocates a server id and version, with inactive default", async () => {
  const h = harness();
  const saved = await h.save({ id: undefined });
  assert.equal(saved.version, 2); assert.equal(saved.active, false);
  assert.equal(h.state.recipes[0].active, true);
});

test("unknown ids, foreign tenants and moving a recipe across variants fail without mutation", async () => {
  for (const [patch, tenant] of [[{ id: "missing" }, "tenant-a"], [{ size: "BOWL" }, "tenant-a"], [{}, "tenant-b"]] as const) {
    const h = harness();
    await assert.rejects(h.save(patch, tenant));
    assert.deepEqual(h.state.recipes, [original()]); assert.equal(h.state.audits.length, 0);
    assert.equal(h.calls.at(-1)?.sql, "ROLLBACK"); assert.equal(h.state.released, 1);
  }
});

test("bad input is rejected before borrowing a database connection", async () => {
  for (const patch of [{ outputQty: 1.9 }, { active: "true" }, { items: [{ ...ingredient, qty: 1.9 }] }, { items: [{ ...ingredient, sku: "MENU" }] }]) {
    const h = harness(); await assert.rejects(h.save(patch)); assert.equal(h.state.acquired, 0);
  }
});

test("component, readiness and audit failures roll back the replacement and activation together", async () => {
  for (const flag of ["failItem", "failReadiness", "failAudit"] as const) {
    const h = harness(); h.state[flag] = true;
    await assert.rejects(h.save({ items: [{ ...ingredient, qty: 125 }] }));
    assert.deepEqual(h.state.recipes, [original()]); assert.equal(h.state.audits.length, 0);
    assert.equal(h.calls.at(-1)?.sql, "ROLLBACK"); assert.equal(h.state.released, 1);
  }
});

test("recipe mutation keeps the existing tenant/permission boundary and moves audit inside the transaction", () => {
  const adapter = read("apps/web/graphql/bmsStockCapabilities.ts");
  const body = adapter.slice(adapter.indexOf("async bmsUpsertProductRecipe"), adapter.indexOf("async bmsSetProductBundleItems"));
  assert.match(body, /requirePermission\(ctx, "product.edit"\)/);
  assert.match(body, /getTenantId\(ctx\)/);
  assert.doesNotMatch(body, /await audit\(/);
  const source = read("apps/web/lib/bms/productRecipes.ts");
  const mutation = source.slice(source.indexOf("export async function upsertProductRecipe"), source.indexOf("export type ProductModifier"));
  assert.match(mutation, /SELECT active FROM bms_products WHERE tenant_id = \$1 AND sku = \$2 FOR UPDATE/);
  assert.ok(mutation.indexOf("INSERT INTO bms_audit_log") < mutation.indexOf('client.query("COMMIT")'));
});

const childId = "00000000-0000-4000-8000-000000000001";
const childV2Id = "00000000-0000-4000-8000-000000000002";
function child(version = 1) {
  return { id: version === 1 ? childId : childV2Id, tenant_id: "tenant-a", product_sku: "SAUCE", size: "GRAM",
    version, output_qty: 100, active: false, items: [{ sku: "SUGAR", size: "GRAM", qty: 50 * version }], children: [] };
}

test("SOP-only edits append a version; omitted steps preserve it and no-op retains its id", async () => {
  const h = harness();
  const saved = await h.save({ sopSteps: [" Mix ", "Cook"] });
  assert.equal(saved.id, "recipe-2"); assert.deepEqual(saved.sopSteps, ["Mix", "Cook"]);
  assert.deepEqual(h.state.recipes[0].sop_steps, []);
  assert.equal((await h.save({ id: saved.id })).id, saved.id);
  assert.deepEqual(h.state.recipes[1].sop_steps, ["Mix", "Cook"]);
  assert.equal((await h.save({ id: saved.id, sopSteps: [] })).version, 3);
});

test("pinned inactive child compiles once; child updates never silently upgrade its parent", async () => {
  const h = harness(); h.state.children.push(child());
  const parent = await h.save({ items: undefined, directItems: [], subrecipes: [{ recipeId: childId, qty: 20 }] });
  assert.deepEqual(parent.items, [{ sku: "SUGAR", size: "GRAM", qty: 10 }]);
  assert.deepEqual(parent.directItems, []); assert.equal(parent.subrecipes[0].version, 1);
  h.state.children.push(child(2));
  const repeated = await h.save({ id: parent.id, items: undefined, active: false });
  assert.equal(repeated.id, parent.id); assert.deepEqual(repeated.items, parent.items);
  const upgraded = await h.save({ id: parent.id, items: undefined, subrecipes: [{ recipeId: childV2Id, qty: 20 }] });
  assert.equal(upgraded.version, 3); assert.equal(upgraded.items[0].qty, 20);
  assert.equal(h.state.recipes[1].items[0].qty, 10, "old compiled BOM stays unchanged");
});

test("legacy clients cannot double-count or flatten away pinned references and SOP", async () => {
  const h = harness(); h.state.children.push(child());
  const parent = await h.save({ items: undefined, directItems: [ingredient],
    subrecipes: [{ recipeId: childId, qty: 20 }], sopSteps: ["Mix"] });
  const replay = await h.save({ id: parent.id, items: parent.items });
  assert.equal(replay.id, parent.id); assert.deepEqual(replay.subrecipes, parent.subrecipes);
  assert.deepEqual(replay.sopSteps, ["Mix"]); assert.deepEqual(replay.items, parent.items);
  await assert.rejects(h.save({ id: parent.id, items: [ingredient] }), /directItems/);
});

test("bad references, cross-tenant children and reference-write failures preserve old activation and audit", async () => {
  for (const mode of ["missing", "foreign", "write-failure"] as const) {
    const h = harness();
    if (mode !== "missing") h.state.children.push({ ...child(), tenant_id: mode === "foreign" ? "tenant-b" : "tenant-a" });
    h.state.failReference = mode === "write-failure";
    await assert.rejects(h.save({ subrecipes: [{ recipeId: childId, qty: 20 }] }));
    assert.deepEqual(h.state.recipes, [original()]); assert.equal(h.state.audits.length, 0);
    assert.equal(h.calls.at(-1)?.sql, "ROLLBACK");
  }
});

test("invalid SOP and mutually exclusive legacy/new ingredient inputs fail before connecting", async () => {
  for (const patch of [{ sopSteps: [""] }, { sopSteps: ["x".repeat(2001)] }, { sopSteps: null },
    { subrecipes: [{ recipeId: "bad", qty: 1 }] }, { directItems: [] }]) {
    const h = harness(); await assert.rejects(h.save(patch)); assert.equal(h.state.acquired, 0);
  }
});
