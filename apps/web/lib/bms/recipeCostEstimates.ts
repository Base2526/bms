import { query } from "@/lib/db";
import { calculateRecipeCostEstimate } from "./recipeCosting";

/** One statement gives a consistent current-catalog observation, not historical actual COGS. */
export async function getRecipeCostEstimate(tenantId: string, recipeId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recipeId)) {
    throw new Error("Invalid recipe id");
  }
  const result = await query<{
    id: string; version: number; output_qty: number; cost_assumptions: unknown; calculated_at: Date | string;
    ingredients: Array<{ sku: string; size: string; qty: number; unitCost: string | null }>;
  }>(`SELECT r.id, r.version, r.output_qty, r.cost_assumptions, statement_timestamp() AS calculated_at,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('sku', i.component_sku, 'size', i.component_size,
         'qty', i.qty, 'unitCost', p.cost_price::text) ORDER BY i.component_sku, i.component_size)
         FROM bms_product_recipe_items i LEFT JOIN bms_products p
           ON p.tenant_id=i.tenant_id AND p.sku=i.component_sku
         WHERE i.tenant_id=r.tenant_id AND i.recipe_id=r.id), '[]'::jsonb) AS ingredients
       FROM bms_product_recipes r WHERE r.tenant_id=$1 AND r.id=$2`, [tenantId, recipeId]);
  const row = result.rows[0];
  if (!row) return null; // Missing and foreign-tenant ids have the same response.
  return { recipeId: row.id, recipeVersion: Number(row.version),
    calculatedAt: new Date(row.calculated_at).toISOString(),
    ...calculateRecipeCostEstimate({ outputQty: Number(row.output_qty), assumptions: row.cost_assumptions, ingredients: row.ingredients }) };
}
