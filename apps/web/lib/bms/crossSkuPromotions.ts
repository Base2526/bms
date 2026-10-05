import type { PoolClient } from "pg";
import { normalizeCrossSkuPromotion, type CrossSkuPromotion } from "@pos-core/crossSkuPromotion";
import type { Promotion } from "./pricing";

export function promotionFromRow(row: Record<string, any>): Promotion | null {
  if (row.kind === "BUY_A_GET_B") return normalizeCrossSkuPromotion({
    kind: row.kind, id: String(row.id), buySku: row.product_sku, buySize: row.buy_size,
    buyQty: Number(row.buy_qty), giftSku: row.gift_sku, giftSize: row.gift_size, getQty: Number(row.get_qty),
  });
  if (row.kind === "BUY_X_GET_Y") return { kind: row.kind, buyQty: Number(row.buy_qty), getQty: Number(row.get_qty) };
  if (row.kind === "N_FOR_PRICE") return { kind: row.kind, buyQty: Number(row.buy_qty), bundlePrice: Number(row.bundle_price) };
  return null;
}

/** Repeat at settlement: catalog edits after publishing must not widen gift eligibility. */
export async function validateCrossSkuProducts(client: Pick<PoolClient, "query">, tenantId: string, rule: Pick<CrossSkuPromotion, "buySku" | "buySize" | "giftSku" | "giftSize">) {
  for (const [sku, size] of [[rule.buySku, rule.buySize], [rule.giftSku, rule.giftSize]]) {
    const result = await client.query(
      `SELECT p.sku FROM bms_products p
       LEFT JOIN bms_product_stock_policies sp ON sp.tenant_id=p.tenant_id AND sp.product_sku=p.sku
       WHERE p.tenant_id=$1 AND p.sku=$2 AND p.active AND NOT p.is_bundle AND NOT p.serial_tracked
         AND COALESCE(sp.stock_policy,'DIRECT')='DIRECT'
         AND NOT EXISTS (SELECT 1 FROM bms_pharmacy_product_policies ph WHERE ph.tenant_id=p.tenant_id AND ph.product_sku=p.sku)
         AND EXISTS (SELECT 1 FROM bms_product_variants v WHERE v.tenant_id=p.tenant_id AND v.product_sku=p.sku AND v.code=$3 AND v.active)
         AND EXISTS (SELECT 1 FROM bms_product_sales_surfaces s WHERE s.tenant_id=p.tenant_id AND s.product_sku=p.sku AND s.surface='RETAIL_POS' AND s.enabled)`,
      [tenantId, sku, size],
    );
    if (!result.rowCount) throw new Error(`โปรแถมข้ามสินค้าใช้ได้เฉพาะสินค้าสต็อกปกติที่ขายหน้าร้านได้: ${sku} (${size})`);
  }
}
