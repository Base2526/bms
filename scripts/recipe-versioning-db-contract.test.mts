import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { query } from "../apps/web/lib/db.ts";
import { listProductRecipes, upsertProductRecipe } from "../apps/web/lib/bms/productRecipes.ts";

// Run ONLY through run-contract-tests.mjs db recipe-versioning, against the restored disposable DB.
// All rows belong to the exact tenant UUID created by each fixture; cleanup cannot touch real shops.
async function fixture(work: (tenant: string, save: (patch?: any) => ReturnType<typeof upsertProductRecipe>) => Promise<void>) {
  const tenant = randomUUID();
  await query(`INSERT INTO bms_tenants (id,name,slug) VALUES ($1,$2,$3)`,
    [tenant, "FAKE recipe version contract", `fake-recipe-version-${tenant}`]);
  try {
    for (const sku of ["FAKE-MENU", "FAKE-RICE"]) {
      await query(`INSERT INTO bms_products (tenant_id,sku,name,price,active,vat_category) VALUES ($1,$2,$2,10,FALSE,'V')`, [tenant, sku]);
    }
    const save = (patch: any = {}) => upsertProductRecipe(tenant, {
      productSku: "FAKE-MENU", size: "PLATE", outputQty: 1, active: true,
      items: [{ sku: "FAKE-RICE", size: "GRAM", qty: 100 }], ...patch,
    });
    await work(tenant, save);
  } finally {
    await query(`DELETE FROM bms_tenants WHERE id=$1`, [tenant]);
  }
}

test("DB recipe edits append content and atomically audit the source/new ids", async () => {
  await fixture(async (tenant, save) => {
    const first = await save();
    const second = await save({ id: first.id, outputQty: 2 });
    assert.notEqual(second.id, first.id); assert.equal(second.version, first.version + 1);
    const recipes = await listProductRecipes(tenant, "FAKE-MENU", "PLATE");
    const old = recipes.find(r => r.id === first.id)!;
    assert.equal(old.outputQty, 1); assert.equal(old.active, false);
    assert.deepEqual(old.items, first.items);
    assert.equal(recipes.filter(r => r.active).length, 1);
    const audit = await query(`SELECT meta FROM bms_audit_log WHERE tenant_id=$1 AND target=$2 AND action='product.recipe_upsert'`, [tenant, second.id]);
    assert.equal(audit.rowCount, 1); assert.equal(audit.rows[0].meta.sourceRecipeId, first.id);
    const unchanged = await save({ id: second.id, outputQty: 2 });
    assert.equal(unchanged.id, second.id);
    assert.equal((await listProductRecipes(tenant, "FAKE-MENU")).length, 2);
  });
});

test("DB inactive edit preserves the active version and status-only activation keeps the id", async () => {
  await fixture(async (tenant, save) => {
    const first = await save();
    const draft = await save({ id: first.id, outputQty: 2, active: false });
    let recipes = await listProductRecipes(tenant, "FAKE-MENU");
    assert.equal(recipes.find(r => r.active)?.id, first.id);
    const activated = await save({ id: draft.id, outputQty: 2, active: true });
    assert.equal(activated.id, draft.id);
    recipes = await listProductRecipes(tenant, "FAKE-MENU");
    assert.equal(recipes.length, 2); assert.equal(recipes.find(r => r.active)?.id, draft.id);
  });
});

test("DB invalid component rolls back new version, old deactivation and audit", async () => {
  await fixture(async (tenant, save) => {
    const first = await save();
    await assert.rejects(save({ id: first.id, items: [{ sku: "FAKE-MISSING", size: "GRAM", qty: 1 }] }));
    assert.deepEqual(await listProductRecipes(tenant, "FAKE-MENU"), [first]);
    const audit = await query(`SELECT count(*)::int AS n FROM bms_audit_log WHERE tenant_id=$1 AND action='product.recipe_upsert'`, [tenant]);
    assert.equal(audit.rows[0].n, 1);
  });
});

test("DB tenant-bound service cannot edit another tenant's recipe id", async () => {
  await fixture(async (tenantA, saveA) => {
    const first = await saveA();
    await fixture(async (_tenantB, saveB) => {
      await assert.rejects(saveB({ id: first.id, outputQty: 2 }), /ไม่พบสูตรนี้ในร้าน/);
    });
    assert.deepEqual(await listProductRecipes(tenantA, "FAKE-MENU"), [first]);
  });
});

test("DB concurrent edits allocate distinct versions under the product lock", async () => {
  await fixture(async (tenant, save) => {
    const first = await save();
    const edits = await Promise.all([2, 3, 4, 5].map(outputQty => save({ id: first.id, outputQty, active: false })));
    assert.deepEqual(edits.map(r => r.version).sort((a,b) => a-b), [2, 3, 4, 5]);
    assert.equal(new Set(edits.map(r => r.id)).size, 4);
    const recipes = await listProductRecipes(tenant, "FAKE-MENU");
    assert.equal(recipes.length, 5); assert.equal(recipes.find(r => r.active)?.id, first.id);
  });
});
