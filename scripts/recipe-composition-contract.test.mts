import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "../apps/web/node_modules/typescript/lib/typescript.js";
import { flattenRecipeComposition, loadPinnedRecipeCompositionInTx, normalizeDirectRecipeItems,
  normalizeRecipeReferences, normalizeRecipeSteps, sameRecipeReferences } from "../apps/web/lib/bms/recipeComposition.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ingredient = { sku: "SUGAR", size: "GRAM", qty: 60 };
const child = { recipeId: id(1), productSku: "SAUCE", size: "GRAM", qty: 20, outputQty: 100, version: 1, items: [ingredient] };

test("child quantity means output units, not batches; duplicate leaf ingredients aggregate", () => {
  const direct = [{ ...ingredient, qty: 3 }];
  assert.deepEqual(flattenRecipeComposition("MENU", direct, [child]), [{ ...ingredient, qty: 15 }]);
  assert.deepEqual(direct, [{ ...ingredient, qty: 3 }]);
  assert.equal(child.items[0].qty, 60);
  assert.deepEqual(flattenRecipeComposition("MENU", [], [{ ...child, qty: 200 }]), [{ ...ingredient, qty: 120 }]);
});

test("fractional base units and integer overflow reject instead of rounding or truncating", () => {
  assert.throws(() => flattenRecipeComposition("MENU", [], [{ ...child, qty: 1 }]), /เศษหน่วย/);
  assert.throws(() => flattenRecipeComposition("MENU", [{ ...ingredient, qty: 2147483647 }], [child]), /ขอบเขต/);
  assert.throws(() => flattenRecipeComposition("MENU", [], [{ ...child, qty: 2147483647,
    outputQty: 1, items: [{ ...ingredient, qty: 2147483647 }] }]), /ขอบเขต/);
  assert.deepEqual(flattenRecipeComposition("MENU", [], [{ ...child, qty: 2147483647,
    outputQty: 2147483647, items: [{ ...ingredient, qty: 2147483647 }] }]), [{ ...ingredient, qty: 2147483647 }]);
});

test("flat and composed recipes reject self-consumption, empty BOMs, duplicates and oversized inputs", () => {
  assert.throws(() => flattenRecipeComposition("SUGAR", [ingredient], []));
  assert.throws(() => flattenRecipeComposition("SAUCE", [], [child]));
  assert.throws(() => flattenRecipeComposition("MENU", [], []));
  assert.throws(() => normalizeDirectRecipeItems([ingredient, { ...ingredient, sku: " SUGAR " }]));
  assert.throws(() => normalizeDirectRecipeItems(Array(201).fill(ingredient)));
  assert.throws(() => normalizeDirectRecipeItems(null));
});

test("reference boundary rejects forged IDs, duplicate pins, bad quantities and unbounded graphs", () => {
  for (const value of [null, {}, [null], [{ recipeId: "bad", qty: 1 }], [{ recipeId: id(1), qty: "1" }],
    [{ recipeId: id(1), qty: 0 }], [{ recipeId: id(1), qty: 1.5 }], [{ recipeId: id(1), qty: 2147483648 }],
    [{ recipeId: id(1), qty: 1 }, { recipeId: id(1), qty: 2 }], Array.from({ length: 21 }, (_, i) => ({ recipeId: id(i), qty: 1 }))]) {
    assert.throws(() => normalizeRecipeReferences(value));
  }
  assert.deepEqual(normalizeRecipeReferences([{ recipeId: ` ${id(1)} `, qty: 1 }]), [{ recipeId: id(1), qty: 1 }]);
  assert.ok(sameRecipeReferences([{ recipeId: id(1), qty: 2 }, { recipeId: id(2), qty: 3 }],
    [{ recipeId: id(2), qty: 3 }, { recipeId: id(1), qty: 2 }]));
  assert.ok(!sameRecipeReferences([{ recipeId: id(1), qty: 2 }], [{ recipeId: id(2), qty: 2 }]));
});

test("SOP keeps sequence and plain text, trims edges and validates bounded nonempty steps", () => {
  assert.deepEqual(normalizeRecipeSteps(["  Mix\nslowly ", "<b>Cook</b>"]), ["Mix\nslowly", "<b>Cook</b>"]);
  for (const value of [null, [null], [1], [" "], ["x".repeat(2001)], Array(51).fill("Mix")]) assert.throws(() => normalizeRecipeSteps(value));
  assert.deepEqual(normalizeRecipeSteps([]), []);
});

function graph() {
  const nodes = new Map<string, any>(); const calls: string[] = [];
  const add = (n: number, sku = `RECIPE-${n}`, children: number[] = []) => nodes.set(id(n), {
    id: id(n), product_sku: sku, size: "GRAM", version: 1, output_qty: 100, items: [ingredient],
    children: children.map(i => ({ recipeId: id(i), qty: 100 })),
  });
  const client: any = { query: async (sql: string, args: any[]) => {
    assert.match(sql, /r.tenant_id=\$1 AND r.id=\$2 FOR KEY SHARE OF r/);
    assert.doesNotMatch(sql, /r\.active/); calls.push(args[1]);
    const node = args[0] === "tenant-a" ? nodes.get(args[1]) : undefined;
    return { rows: node ? [structuredClone(node)] : [], rowCount: node ? 1 : 0 };
  } };
  return { nodes, calls, add, load: (tenant = "tenant-a") => loadPinnedRecipeCompositionInTx(client, tenant, "MENU", [{ recipeId: id(1), qty: 20 }]) };
}

test("nested pins are tenant-scoped, retain exact inactive versions and load shared nodes once", async () => {
  const h = graph(); h.add(1, "SAUCE", [2, 3]); h.add(2, "MIX-A", [4]); h.add(3, "MIX-B", [4]); h.add(4);
  const loaded = await h.load(); assert.equal(loaded[0].recipeId, id(1)); assert.equal(loaded[0].version, 1);
  assert.equal(h.calls.filter(call => call === id(4)).length, 1);
  await assert.rejects(h.load("tenant-b"), /ไม่พบ/);
  h.nodes.delete(id(4)); await assert.rejects(h.load(), /ไม่พบ/);
});

test("recipe cycles across different historical IDs and excessive depth fail closed", async () => {
  const h = graph(); h.add(1, "SAUCE", [2]); h.add(2, "MENU");
  await assert.rejects(h.load(), /วนกลับ/);
  h.add(2, "SAUCE"); await assert.rejects(h.load(), /วนกลับ/);
  h.nodes.clear(); for (let n = 1; n <= 9; n++) h.add(n, `SKU-${n}`, n < 9 ? [n + 1] : []);
  await assert.rejects(h.load(), /8 ระดับ/);
});

test("wide and repeatedly shared recipe graphs are bounded independently of depth", async () => {
  const h = graph(); h.add(1, "ROOT", [2, 3, 4, 5]);
  let next = 6;
  for (let n = 2; n <= 5; n++) {
    const children = Array.from({ length: 20 }, () => next++); h.add(n, `P-${n}`, children);
    children.forEach(c => h.add(c));
  }
  await assert.rejects(h.load(), /64 versions/);
  const shared = graph(); shared.add(1, "ROOT", [2, 3, 4, 5]);
  for (let n = 2; n <= 5; n++) shared.add(n, `P-${n}`, [6, 7, 8, 9]);
  for (let n = 6; n <= 9; n++) shared.add(n, `Q-${n}`, [10, 11, 12, 13]);
  for (let n = 10; n <= 13; n++) shared.add(n, `R-${n}`, [14, 15, 16, 17]);
  for (let n = 14; n <= 17; n++) shared.add(n);
  await assert.rejects(shared.load(), /ซับซ้อน/);
});

test("recipe GraphQL adapter enforces permission, server tenant and maps bad input", async () => {
  let allowed = false; let invalid = false; const calls: any[] = [];
  class InputError extends Error { extensions: any; constructor(message: string, options: any) { super(message); this.extensions = options.extensions; } }
  const exports: any = {};
  const js = ts.transpileModule(read("apps/web/graphql/bmsStockCapabilities.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "exports", js)((name: string) => {
    if (name === "graphql/error") return { GraphQLError: InputError };
    if (name === "@/lib/auth") return { requireAuth: () => ({ author_id: "staff" }) };
    if (name === "@/lib/bms/permissions") return { requirePermission: async (_ctx: any, permission: string) => {
      assert.equal(permission, "product.edit"); if (!allowed) throw new Error("FORBIDDEN");
    } };
    if (name === "@/lib/bms/tenant") return { getTenantId: () => "server-tenant" };
    if (name === "@/lib/bms/productRecipes") return { upsertProductRecipe: async (...args: any[]) => {
      calls.push(args); if (invalid) throw new Error("invalid composition"); return { id: "saved-version" };
    } };
    return {};
  }, exports);
  const save = () => exports.bmsStockCapabilityResolvers.Mutation.bmsUpsertProductRecipe(null,
    { input: { tenantId: "forged-tenant", productSku: "MENU", directItems: [] } }, {});
  await assert.rejects(save(), /FORBIDDEN/); assert.equal(calls.length, 0);
  allowed = true; assert.deepEqual(await save(), { id: "saved-version" });
  assert.equal(calls[0][0], "server-tenant"); assert.equal(calls[0][2], "staff");
  invalid = true; await assert.rejects(save(), (e: any) => e.extensions.code === "BAD_USER_INPUT");
});

test("migration keeps tenant FK/RLS/grants, while sale-time stock still reads only the leaf BOM", () => {
  const sql = read("db/migrations/10.62__bms_recipe_composition_sop.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS direct_items/); assert.match(sql, /ADD COLUMN IF NOT EXISTS sop_steps/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS bms_product_recipe_subrecipes/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, child_recipe_id\) REFERENCES bms_product_recipes\(tenant_id,id\)/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/); assert.match(sql, /WITH CHECK/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON bms_product_recipe_subrecipes TO bms_app/);
  assert.match(sql, /ROLLBACK/);
  assert.doesNotMatch(read("apps/web/lib/bms/stockConsumption.ts"), /recipe_subrecipes|direct_items|sop_steps/);
  const ui = read("apps/web/app/(admin)/admin/stock-models/page.tsx");
  assert.match(ui, /directItems: \(values.items/); assert.doesNotMatch(ui, /dangerouslySetInnerHTML/);
  const saveUi = ui.slice(ui.indexOf("async function submitRecipe"), ui.indexOf("function openBundle"));
  assert.match(saveUi, /await model.refetch\(\)/);
  assert.match(read("apps/web/lib/bms/productRecipes.ts"), /FOR NO KEY UPDATE OF r/);
});
