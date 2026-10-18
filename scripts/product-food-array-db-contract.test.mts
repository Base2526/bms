// Run through: node scripts/run-contract-tests.mjs db product-food-array
// Exercise the actual upsert SQL on a session-local table; all changes roll back.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getClient } from "../apps/web/lib/db.ts";

const source = readFileSync(new URL("../apps/web/lib/bms/products.ts", import.meta.url), "utf8");
const sql = source.slice(source.indexOf("export async function upsertProduct("))
  .match(/`(INSERT INTO bms_products[\s\S]*?)`/)?.[1];

test("product food arrays: PostgreSQL round trips and original error reproduction", async (t) => {
  assert.ok(sql, "Locate the production upsert statement, not a copied query");
  const client = await getClient();
  try {
    await client.query("BEGIN");
    // LIKE copies the real column types/defaults/constraints/indexes but no triggers or FKs.
    // The temporary table shadows the public table only on this connection.
    await client.query(`CREATE TEMP TABLE bms_products
      (LIKE public.bms_products INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)
      ON COMMIT DROP`);
    const params: unknown[] = [
      "00000000-0000-4000-8000-000000000001", "ARRAY-TEST", "Array test", 100, [], false,
      null, null, null, null, null, null, null, null, null, null, null, null, null,
    ];
    const save = async (allergens: string[] | null, tags: string[] | null) => {
      const values = [...params];
      values[14] = allergens;
      values[16] = tags;
      const row = (await client.query(sql, values)).rows[0];
      return { allergens: row.allergen_codes, tags: row.dietary_tags };
    };

    await t.test("new product defaults, populated insert, independent update, omission and clear", async () => {
      assert.deepEqual(await save(null, null), { allergens: [], tags: [] });
      params[1] = "ARRAY-POPULATED";
      assert.deepEqual(await save(["MILK", "EGG"], ["VEGETARIAN"]),
        { allergens: ["MILK", "EGG"], tags: ["VEGETARIAN"] });
      assert.deepEqual(await save(null, ["HALAL"]),
        { allergens: ["MILK", "EGG"], tags: ["HALAL"] });
      assert.deepEqual(await save(["SOY"], null), { allergens: ["SOY"], tags: ["HALAL"] });
      assert.deepEqual(await save(null, null), { allergens: ["SOY"], tags: ["HALAL"] });
      assert.deepEqual(await save([], null), { allergens: [], tags: ["HALAL"] });
      assert.deepEqual(await save(null, []), { allergens: [], tags: [] });
    });

    await t.test("INSERT casts already determine parameter types in the conflict clause", async () => {
      const beforeHardening = sql
        .replace("allergen_codes = COALESCE($15::text[],", "allergen_codes = COALESCE($15,")
        .replace("dietary_tags = COALESCE($17::text[],", "dietary_tags = COALESCE($17,");
      const values = [...params];
      values[14] = ["MILK"];
      values[16] = ["VEGETARIAN"];
      const row = (await client.query(beforeHardening, values)).rows[0];
      assert.deepEqual(row.allergen_codes, ["MILK"]);
      assert.deepEqual(row.dietary_tags, ["VEGETARIAN"]);
    });

    for (const [parameter, column] of [[15, "allergen_codes"], [17, "dietary_tags"]] as const) {
      await t.test(`removing only the INSERT cast reproduces the ${column} type error`, async () => {
        const broken = sql.replace(`COALESCE($${parameter}::text[], '{}')`, `COALESCE($${parameter}, '{}')`);
        assert.notEqual(broken, sql, "Mutation must change the INSERT expression");
        await client.query("SAVEPOINT missing_cast");
        try {
          await assert.rejects(client.query(broken, params), {
            code: "42804",
            message: `column "${column}" is of type text[] but expression is of type text`,
          });
        } finally {
          await client.query("ROLLBACK TO SAVEPOINT missing_cast");
        }
      });
    }
  } finally {
    try { await client.query("ROLLBACK"); } finally { client.release(); }
  }
});
