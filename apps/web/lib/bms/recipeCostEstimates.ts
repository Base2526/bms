import type { PoolClient } from "pg";
import { query, getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { assertValuationLocation } from "./inventoryValuation";
import { calculateRecipeCostEstimate } from "./recipeCosting";

export type RecipeCostSelection = { costBasis?: "CATALOG" | "WEIGHTED_AVERAGE"; locationId?: string | null };
export function normalizeCostSelection(input: RecipeCostSelection): Required<RecipeCostSelection> {
  const costBasis=input.costBasis ?? "CATALOG", locationId=input.locationId ?? null;
  if (!["CATALOG","WEIGHTED_AVERAGE"].includes(costBasis) || (costBasis==="WEIGHTED_AVERAGE" &&
    (typeof locationId!=="string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(locationId)))) throw new Error("PRICE_PLAN_INVALID_COST_SELECTION");
  return {costBasis,locationId:costBasis==="CATALOG" ? null : locationId};
}
/** One statement gives a consistent current-catalog observation, not historical actual COGS. */
export async function getRecipeCostEstimate(tenantId: string, recipeId: string, client?: PoolClient, selection: RecipeCostSelection = {}, actor?: string): Promise<({costBasis: string;locationId: string|null;recipeId: string;recipeVersion:number;calculatedAt:string} & ReturnType<typeof calculateRecipeCostEstimate>) | null> {
  const chosen=normalizeCostSelection(selection);
  if (chosen.costBasis=== "WEIGHTED_AVERAGE") {
    if (!actor) throw new Error("VALUATION_FORBIDDEN");
    if (!client) {
      const c=await getClient();
      try { await beginTenantTx(c,tenantId,{serializable:true});
        const result=await getRecipeCostEstimate(tenantId,recipeId,c,chosen,actor);
        await c.query("COMMIT");return result;
      } catch(e) {await c.query("ROLLBACK");throw e;} finally {c.release();}
    }
    await assertValuationLocation(client,tenantId,actor,chosen.locationId!);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recipeId)) {
    throw new Error("Invalid recipe id");
  }
  const runQuery = client ? client.query.bind(client) : query;
  const result = await runQuery<{
    id: string; version: number; output_qty: number; cost_assumptions: unknown; calculated_at: Date | string;
    ingredients: Array<{ sku: string; size: string; qty: number; unitCost: string | null }>;
  }>(`SELECT r.id, r.version, r.output_qty, r.cost_assumptions, statement_timestamp() AS calculated_at,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('sku', i.component_sku, 'size', i.component_size,
         'qty', i.qty, 'unitCost', CASE WHEN $4='WEIGHTED_AVERAGE' THEN
           CASE WHEN v.qty>0 AND v.qty=stock.current_stock THEN round(v.value/v.qty,6)::text END ELSE p.cost_price::text END) ORDER BY i.component_sku, i.component_size)
         FROM bms_product_recipe_items i LEFT JOIN bms_products p
           ON p.tenant_id=i.tenant_id AND p.sku=i.component_sku
         LEFT JOIN bms_inventory_values v ON v.tenant_id=i.tenant_id AND v.location_id=$3::uuid
           AND v.product_sku=i.component_sku AND v.size=i.component_size
         LEFT JOIN bms_inventory stock ON stock.tenant_id=i.tenant_id AND stock.location_id=$3::uuid
           AND stock.product_sku=i.component_sku AND stock.size=i.component_size
         WHERE i.tenant_id=r.tenant_id AND i.recipe_id=r.id), '[]'::jsonb) AS ingredients
       FROM bms_product_recipes r WHERE r.tenant_id=$1 AND r.id=$2`, [tenantId, recipeId,chosen.locationId,chosen.costBasis]);
  const row = result.rows[0];
  if (!row) return null; // Missing and foreign-tenant ids have the same response.
  return { costBasis:chosen.costBasis, locationId:chosen.locationId, recipeId: row.id, recipeVersion: Number(row.version),
    calculatedAt: new Date(row.calculated_at).toISOString(),
    ...calculateRecipeCostEstimate({ outputQty: Number(row.output_qty), assumptions: row.cost_assumptions, ingredients: row.ingredients, costSource: chosen.costBasis === "WEIGHTED_AVERAGE" ? "MOVING_WEIGHTED_AVERAGE" : "CATALOG_CURRENT" }) };
}
