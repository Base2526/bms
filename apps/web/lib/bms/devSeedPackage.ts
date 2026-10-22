import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import { getTenantEntitlements, getUsage } from "./entitlements";
import { isRetailLocalDeployment } from "./deploymentMode";
import { RESTAURANT_INGREDIENTS } from "./restaurantCatalogSeed";

export async function missingFakeRecipeIngredients(tenantId: string, client?: PoolClient) {
  const skus = RESTAURANT_INGREDIENTS.map(item => `FAKE-ING-${item.code}`);
  const sql = `SELECT COUNT(*)::int AS n FROM bms_products WHERE tenant_id = $1 AND sku = ANY($2::text[])`;
  const result = client ? await client.query(sql, [tenantId, skus]) : await query(sql, [tenantId, skus]);
  return skus.length - Number(result.rows[0].n);
}

/** Advisory snapshot. Writers must still enforce quota under their tenant lock. */
export async function getFakeSeedPackage(tenantId: string) {
  const [entitlements, usage] = await Promise.all([getTenantEntitlements(tenantId), getUsage(tenantId)]);
  const local = isRetailLocalDeployment();
  const slot = (used: number, limit: number) => ({ used, limit, remaining: limit < 0 ? -1 : Math.max(0, limit - used) });
  const devices = entitlements.capacities.find(item => item.resource === "devices")!;
  return {
    plan: entitlements.plan,
    products: slot(usage.products, local ? -1 : entitlements.plan.max_products),
    users: slot(usage.users, local ? -1 : entitlements.plan.max_users),
    devices: slot(devices.used, devices.limit),
    capacities: entitlements.capacities,
  };
}

export function fitFakeSeedCounts<T extends { staff: number; products: number; posDevices: number }>(
  requested: T,
  budget: Pick<Awaited<ReturnType<typeof getFakeSeedPackage>>, "users" | "products" | "devices">,
  recipeIngredients = 0,
): T {
  const fit = (wanted: number, remaining: number) => remaining < 0 ? wanted : Math.min(wanted, remaining);
  return { ...requested,
    staff: fit(requested.staff, budget.users.remaining),
    products: fit(requested.products, budget.products.remaining < 0 ? -1 : Math.max(0, budget.products.remaining - recipeIngredients)),
    posDevices: fit(requested.posDevices, budget.devices.remaining),
  };
}
