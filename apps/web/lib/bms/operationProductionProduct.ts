import type { PoolClient } from "pg";
import { rejectChecklist as reject } from "./operationChecklistPolicy";

/** Lock a stocked variant and its unit before interpreting production material. */
export async function directProduct(
  c: PoolClient,
  tenant: string,
  sku: string,
  size: string,
  options: { includeInactive?: boolean } = {},
) {
  const p = (
    await c.query(
      `SELECT sku,serial_tracked,is_bundle FROM bms_products WHERE tenant_id=$1 AND sku=$2 FOR SHARE`,
      [tenant, sku],
    )
  ).rows[0];
  const policy = (
    await c.query(
      `SELECT stock_policy,base_unit FROM bms_product_stock_policies WHERE tenant_id=$1 AND product_sku=$2 FOR SHARE`,
      [tenant, sku],
    )
  ).rows[0];
  const variant = await c.query(
    `SELECT code FROM bms_product_variants WHERE tenant_id=$1 AND product_sku=$2 AND code=$3 AND (active OR $4) FOR SHARE`,
    [tenant, sku, size, options.includeInactive === true],
  );
  if (
    !p || p.serial_tracked || p.is_bundle || !variant.rowCount ||
    (policy?.stock_policy ?? "DIRECT") !== "DIRECT"
  ) return reject("DIRECT_STOCK_REQUIRED");
  return policy?.base_unit ?? "PIECE";
}
