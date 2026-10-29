import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHash } from "node:crypto";
import { createPurchaseOrderInTx } from "../apps/web/lib/bms/purchase.ts";
import type { PoolClient } from "pg";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const baseLine = {sku:"TEST",size:"BASE",qty:2,unitCost:10};

test("invalid allocations and conflicting duplicate costs reject before any database write", async () => {
  const client = {query: async () => { throw new Error("Unexpected database access"); }} as unknown as PoolClient;
  for (const items of [
    [{...baseLine,additionalUnitCost:0.001,additionalCostNote:"freight"}],
    [{...baseLine,additionalUnitCost:1}],
    [{...baseLine,additionalUnitCost:-1}],
    [{...baseLine,additionalUnitCost:Infinity}],
    [{...baseLine,additionalUnitCost:10000000000,additionalCostNote:"freight"}],
    [{...baseLine,unitCost:9999999999.99,additionalUnitCost:1,additionalCostNote:"freight"}],
    [{...baseLine,additionalUnitCost:1,additionalCostNote:"x".repeat(501)}],
    [baseLine,{...baseLine,unitCost:11}],
    [baseLine,{...baseLine,additionalUnitCost:1,additionalCostNote:"freight"}],
    [{...baseLine,additionalUnitCost:1,additionalCostNote:"A"},{...baseLine,additionalUnitCost:1,additionalCostNote:"B"}],
  ]) assert.deepEqual(await createPurchaseOrderInTx(client,{tenantId:"test",items}),{status:"INVALID_INPUT"});
});

test("legacy retry fingerprints survive rollout and identical duplicate lines merge", async () => {
  let fingerprint = "";
  const client = {query:async (sql:string,values:unknown[]) => {
    if(sql.includes("INSERT INTO bms_purchase_order_idempotency")) {
      fingerprint = String(values[2]); return {rowCount:1,rows:[]};
    }
    assert.match(sql,/SELECT 1 FROM bms_products/);
    return {rowCount:0,rows:[]};
  }} as unknown as PoolClient;
  const result = await createPurchaseOrderInTx(client,{tenantId:"test",requestId:"retry-123",items:[baseLine,baseLine]});
  assert.equal(result.status,"NOT_FOUND");
  const expected = createHash("sha256").update(JSON.stringify({supplierId:null,supplierName:null,note:null,
    items:[{...baseLine,qty:4,supplierSku:null,supplierProductName:null,supplierBarcode:null}]})).digest("hex");
  assert.equal(fingerprint,expected);
  await createPurchaseOrderInTx(client,{tenantId:"test",requestId:"retry-123",items:[{...baseLine,qty:4,additionalUnitCost:0.29,additionalCostNote:"freight"}]});
  assert.notEqual(fingerprint,expected);
});

test("PO line preserves base and additional acquisition cost separately", () => {
  const purchase = read("apps/web/lib/bms/purchase.ts");
  assert.match(purchase, /additionalUnitCost: Number\(it\.additionalUnitCost \?\? 0\)/);
  assert.match(purchase, /qty_ordered, unit_cost, additional_unit_cost/);
  assert.match(purchase, /landedUnitCost: it\.unitCost \+ it\.additionalUnitCost/);
  assert.match(purchase, /qty_ordered \* \(i\.unit_cost \+ i\.additional_unit_cost\)/);
  assert.match(purchase, /!validCost\(it\.additionalUnitCost\)/);
});

test("inventory receipt valuation and lot cost use landed unit cost", () => {
  const valuation = read("apps/web/lib/bms/inventoryValuation.ts");
  const purchase = read("apps/web/lib/bms/purchase.ts");
  assert.match(valuation, /\(i\.unit_cost\+i\.additional_unit_cost\)\*\$3/);
  assert.match(purchase, /unitCost: Number\(unit_cost\) \+ Number\(additional_unit_cost\)/);
});

test("landed-cost migration is additive, nonnegative and documented", () => {
  const migration = read("db/migrations/10.103__bms_purchase_landed_unit_cost.sql");
  assert.match(migration, /ADD COLUMN IF NOT EXISTS additional_unit_cost/);
  assert.match(migration, /CHECK \(additional_unit_cost >= 0\) NOT VALID/);
  assert.match(migration, /additional_cost_note/);
  assert.match(migration, /additional_unit_cost > 0/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/);
});

test("GraphQL and admin UI disclose base, additional and landed unit cost", () => {
  const schema = read("apps/web/graphql/typeDefs.ts");
  const page = read("apps/web/app/(admin)/admin/purchase/page.tsx");
  const route = read("apps/web/app/api/bms/purchase/route.ts");
  for (const field of ["additionalUnitCost", "landedUnitCost"]) {
    assert.match(schema, new RegExp(`${field}: Float`));
    assert.match(page, new RegExp(field));
  }
  assert.match(route, /additionalUnitCost: Number\(r\?\.additionalUnitCost \?\? 0\)/);
});
