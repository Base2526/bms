import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getClient } from "../apps/web/lib/db.ts";
import { assertCostingTestDatabase } from "./testing/restaurantCostingFixture.mts";

test("phases 1–9 schema: fresh application and repeated 10.61–10.66 preserve constraints, policies and grants", async () => {
  await assertCostingTestDatabase();
  const client = await getClient();
  const files = ["10.61__bms_restaurant_item_snapshots", "10.62__bms_recipe_composition_sop",
    "10.63__bms_recipe_cost_assumptions", "10.64__bms_operating_cost_reviews",
    "10.65__bms_pos_return_financial_snapshots", "10.66__bms_cost_allocations"];
  const structure = () => client.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
    (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid=c.oid) AS policies,
    (SELECT count(*)::int FROM pg_constraint k WHERE k.conrelid=c.oid) AS constraints,
    (SELECT count(*)::int FROM pg_index i WHERE i.indrelid=c.oid) AS indexes,
    has_table_privilege('bms_app',c.oid,'SELECT') AS readable,
    has_table_privilege('bms_app',c.oid,'INSERT') AS insertable,
    has_table_privilege('bms_app',c.oid,'UPDATE') AS updatable,
    has_table_privilege('bms_app',c.oid,'DELETE') AS deletable
    FROM pg_class c WHERE c.oid=ANY(ARRAY['bms_product_recipe_subrecipes'::regclass,
      'bms_operating_cost_reviews'::regclass,'bms_cost_allocations'::regclass]) ORDER BY c.relname`);
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query("SET LOCAL statement_timeout='30s'");
    // Reconstruct the pre-feature schema INSIDE a rollback-only transaction on the disposable
    // restored instance. Existing post-feature duplicate menu lines cannot model an old database.
    // Transactional TRUNCATE removes those rows for this proof; ROLLBACK restores all copied data.
    await client.query(`TRUNCATE bms_product_recipes,bms_restaurant_check_items,bms_order_items CASCADE`);
    await client.query(`DROP TABLE bms_cost_allocations,bms_operating_cost_reviews,bms_product_recipe_subrecipes;
      DROP TRIGGER bms_pos_return_snapshot_immutable ON bms_pos_returns;
      DROP FUNCTION bms_pos_return_snapshot_immutable();
      ALTER TABLE bms_pos_returns DROP COLUMN financial_snapshot;
      ALTER TABLE bms_product_recipes DROP COLUMN cost_assumptions,DROP COLUMN direct_items,DROP COLUMN sop_steps;
      ALTER TABLE bms_order_items DROP COLUMN restaurant_check_item_id;
      ALTER TABLE bms_restaurant_check_items DROP COLUMN stock_snapshot`);
    let first: any[] = [];
    for (let pass=0; pass<2; pass++) {
      for (const file of files) {
        // Keep the SQL verbatim except the file-level transaction wrapper; all six files share
        // this test's outer rollback. Never edit an applied migration to make this test pass.
        const sql = readFileSync(new URL(`../db/migrations/${file}.sql`,import.meta.url),"utf8")
          .replace(/^\s*(?:BEGIN|COMMIT);\s*$/gm, "");
        await client.query(sql);
      }
      const rows = (await structure()).rows;
      assert.equal(rows.length,3);
      assert.ok(rows.every(r=>r.relrowsecurity && r.relforcerowsecurity && r.policies===1 && r.readable && r.insertable));
      const allocations=rows.find(r=>r.relname==="bms_cost_allocations");
      assert.equal(allocations.updatable,false); assert.equal(allocations.deletable,false);
      if(pass===0) first=rows; else assert.deepEqual(rows,first);
    }
    const trigger = await client.query(`SELECT count(*)::int AS n FROM pg_trigger
      WHERE tgrelid='bms_pos_returns'::regclass AND tgname='bms_pos_return_snapshot_immutable' AND NOT tgisinternal`);
    assert.equal(trigger.rows[0].n,1);
    const columns = await client.query(`SELECT table_name,column_name FROM information_schema.columns WHERE
      (table_name='bms_product_recipes' AND column_name IN ('cost_assumptions','direct_items','sop_steps')) OR
      (table_name='bms_order_items' AND column_name='restaurant_check_item_id') OR
      (table_name='bms_restaurant_check_items' AND column_name='stock_snapshot') OR
      (table_name='bms_pos_returns' AND column_name='financial_snapshot')`);
    assert.equal(columns.rowCount,6);
  } finally { await client.query("ROLLBACK"); client.release(); }
});


test("completion schema: 10.71–10.72 fresh and repeated migration preserve RLS, schedule exclusion and append-only grants", async () => {
  await assertCostingTestDatabase();
  const c=await getClient();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout='10s'");
    await c.query("DROP TABLE bms_branch_prices,bms_menu_profit_allocations");
    await c.query("ALTER TABLE bms_product_promotions DROP CONSTRAINT bms_promotion_windows_exclusive");
    let first:unknown;
    for(let pass=0;pass<2;pass++) {
      for(const file of ['10.71__bms_branch_prices_and_promotion_schedule','10.72__bms_menu_profit_allocations']) {
        await c.query(readFileSync(new URL(`../db/migrations/${file}.sql`,import.meta.url),'utf8').replace(/^\s*(?:BEGIN|COMMIT);\s*$/gm,''));
      }
      const rows=(await c.query(`SELECT relname,relrowsecurity,relforcerowsecurity,
        has_table_privilege('bms_app',oid,'SELECT') AS readable,has_table_privilege('bms_app',oid,'INSERT') AS insertable,
        has_table_privilege('bms_app',oid,'UPDATE') AS updatable,has_table_privilege('bms_app',oid,'DELETE') AS deletable,
        (SELECT count(*)::int FROM pg_policy WHERE polrelid=rel.oid) AS policies
        FROM pg_class rel WHERE relname IN ('bms_branch_prices','bms_menu_profit_allocations') ORDER BY relname`)).rows;
      assert.equal(rows.length,2);assert.ok(rows.every(r=>r.relrowsecurity&&r.relforcerowsecurity&&r.readable&&r.insertable&&r.policies===1));
      assert.equal(rows[1].updatable,false);assert.equal(rows[1].deletable,false);
      assert.equal((await c.query("SELECT 1 FROM pg_constraint WHERE conname='bms_promotion_windows_exclusive'")).rowCount,1);
      if(!pass)first=rows;else assert.deepEqual(rows,first);
    }
    await c.query('SET LOCAL ROLE bms_app');
    await c.query("SELECT set_config('bms.tenant_id','',true)");
    assert.equal((await c.query('SELECT * FROM bms_menu_profit_allocations')).rowCount,0);
    assert.equal((await c.query('SELECT * FROM bms_branch_prices')).rowCount,0);
  } finally {await c.query('ROLLBACK');c.release();}
});
