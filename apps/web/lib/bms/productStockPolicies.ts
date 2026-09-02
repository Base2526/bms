import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { getProductReadinessInTx } from "./productConfiguration";

export const PRODUCT_STOCK_POLICIES = [
  "DIRECT", "PACK", "BUNDLE", "WEIGHTED", "RECIPE", "SERIALIZED", "NON_STOCK",
] as const;
export type ProductStockPolicyCode = typeof PRODUCT_STOCK_POLICIES[number];

export type ProductStockPolicy = {
  productSku: string;
  stockPolicy: ProductStockPolicyCode;
  baseUnit: string;
  displayUnit: string | null;
  displayPrecision: number;
  lotTracking: boolean;
  expiryTracking: boolean;
  fefo: boolean;
  kitchenStation: string | null;
  scaleItemCode: string | null;
  scaleSize: string | null;
};

const POLICY_SET = new Set<string>(PRODUCT_STOCK_POLICIES);
const BASE_UNIT_RE = /^[A-Z][A-Z0-9_]{0,31}$/;

function mapPolicy(row: any): ProductStockPolicy {
  return {
    productSku: row.product_sku,
    stockPolicy: row.stock_policy,
    baseUnit: row.base_unit,
    displayUnit: row.display_unit ?? null,
    displayPrecision: Number(row.display_precision),
    lotTracking: Boolean(row.lot_tracking),
    expiryTracking: Boolean(row.expiry_tracking),
    fefo: Boolean(row.fefo),
    kitchenStation: row.kitchen_station ?? null,
    scaleItemCode: row.scale_item_code ?? null,
    scaleSize: row.scale_size ?? null,
  };
}

export async function getProductStockPolicy(
  tenantId: string,
  productSku: string
): Promise<ProductStockPolicy | null> {
  const result = await query(
    `SELECT * FROM bms_product_stock_policies
      WHERE tenant_id = $1 AND product_sku = $2`,
    [tenantId, productSku]
  );
  return result.rows[0] ? mapPolicy(result.rows[0]) : null;
}

export async function upsertProductStockPolicy(
  tenantId: string,
  input: Partial<Omit<ProductStockPolicy, "productSku">> & {
    productSku: string;
    deactivateDerived?: boolean;
  },
  editorId?: string | null
): Promise<ProductStockPolicy> {
  const current = await getProductStockPolicy(tenantId, input.productSku);
  const stockPolicy = input.stockPolicy ?? current?.stockPolicy ?? "DIRECT";
  const baseUnit = String(input.baseUnit ?? current?.baseUnit ?? "PIECE").trim().toUpperCase();
  const displayPrecision = Math.trunc(Number(input.displayPrecision ?? current?.displayPrecision ?? 0));
  const lotTracking = input.lotTracking ?? current?.lotTracking ?? false;
  const expiryTracking = input.expiryTracking ?? current?.expiryTracking ?? false;
  const fefo = input.fefo ?? current?.fefo ?? false;
  const displayUnit = String(input.displayUnit !== undefined ? input.displayUnit ?? "" : current?.displayUnit ?? "").trim() || null;
  const kitchenStation = String(input.kitchenStation !== undefined ? input.kitchenStation ?? "" : current?.kitchenStation ?? "").trim() || null;
  const scaleItemCode = String(input.scaleItemCode !== undefined ? input.scaleItemCode ?? "" : current?.scaleItemCode ?? "").trim() || null;
  const scaleSize = String(input.scaleSize !== undefined ? input.scaleSize ?? "" : current?.scaleSize ?? "").trim() || null;

  if (!POLICY_SET.has(stockPolicy)) throw new Error("นโยบาย Stock ไม่ถูกต้อง");
  if (!BASE_UNIT_RE.test(baseUnit)) throw new Error("หน่วยฐานต้องเป็นรหัส A-Z, 0-9 หรือ underscore");
  if (displayPrecision < 0 || displayPrecision > 6) throw new Error("จำนวนทศนิยมที่แสดงต้องอยู่ระหว่าง 0–6");
  if ((expiryTracking || fefo) && !lotTracking) throw new Error("Expiry/FEFO ต้องเปิด Lot tracking ด้วย");
  if ((scaleItemCode || scaleSize) && (
    stockPolicy !== "WEIGHTED" || baseUnit !== "GRAM" || !scaleItemCode || !scaleSize
  )) throw new Error("เครื่องชั่งต้องใช้สินค้า WEIGHTED หน่วยฐาน GRAM และระบุรหัส/ไซซ์ให้ครบ");
  if (scaleItemCode && !/^\d{5}$/.test(scaleItemCode)) throw new Error("รหัสสินค้าเครื่องชั่งต้องเป็นตัวเลข 5 หลัก");

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, editorId ? { editorId } : undefined);
    const product = await client.query<{ is_bundle: boolean; serial_tracked: boolean; active: boolean }>(
      `SELECT is_bundle, serial_tracked, active FROM bms_products WHERE tenant_id = $1 AND sku = $2 FOR UPDATE`,
      [tenantId, input.productSku]
    );
    if (!product.rowCount) throw new Error("ไม่พบสินค้านี้ในร้าน");
    if (stockPolicy === "BUNDLE" && !product.rows[0].is_bundle) {
      throw new Error("ต้องตั้งสินค้าเป็น Bundle และกำหนดส่วนประกอบก่อน");
    }
    if (stockPolicy === "SERIALIZED" && !product.rows[0].serial_tracked) {
      throw new Error("ต้องเปิด Serial tracking ที่สินค้าก่อน");
    }
    if (stockPolicy !== "RECIPE") {
      const derived = await client.query<{ recipe_count: number; modifier_count: number }>(
        `SELECT
           (SELECT COUNT(*)::int FROM bms_product_recipes
             WHERE tenant_id = $1 AND product_sku = $2 AND active) AS recipe_count,
           (SELECT COUNT(*)::int FROM bms_product_modifiers
             WHERE tenant_id = $1 AND product_sku = $2 AND active) AS modifier_count`,
        [tenantId, input.productSku]
      );
      const recipeCount = Number(derived.rows[0]?.recipe_count ?? 0);
      const modifierCount = Number(derived.rows[0]?.modifier_count ?? 0);
      if ((recipeCount > 0 || modifierCount > 0) && !input.deactivateDerived) {
        throw new Error(
          `สินค้านี้ยังมีสูตร ${recipeCount} และ Modifier ${modifierCount} รายการที่เปิดใช้ — ยืนยันปิดข้อมูลเหล่านี้ก่อนเปลี่ยนจาก RECIPE`
        );
      }
      if (input.deactivateDerived) {
        await client.query(
          `UPDATE bms_product_recipes SET active = FALSE, updated_at = now()
            WHERE tenant_id = $1 AND product_sku = $2 AND active`,
          [tenantId, input.productSku]
        );
        await client.query(
          `UPDATE bms_product_modifiers SET active = FALSE, updated_at = now()
            WHERE tenant_id = $1 AND product_sku = $2 AND active`,
          [tenantId, input.productSku]
        );
        await client.query(
          `UPDATE bms_product_modifier_groups SET active = FALSE, updated_at = now()
            WHERE tenant_id = $1 AND product_sku = $2 AND active`,
          [tenantId, input.productSku]
        );
      }
    }
    await client.query(
      `INSERT INTO bms_product_stock_policies
         (tenant_id, product_sku, stock_policy, base_unit, display_unit, display_precision,
          lot_tracking, expiry_tracking, fefo, kitchen_station, scale_item_code, scale_size)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (tenant_id, product_sku) DO UPDATE SET
         stock_policy = EXCLUDED.stock_policy, base_unit = EXCLUDED.base_unit,
         display_unit = EXCLUDED.display_unit, display_precision = EXCLUDED.display_precision,
         lot_tracking = EXCLUDED.lot_tracking, expiry_tracking = EXCLUDED.expiry_tracking,
         fefo = EXCLUDED.fefo, kitchen_station = EXCLUDED.kitchen_station,
         scale_item_code = EXCLUDED.scale_item_code, scale_size = EXCLUDED.scale_size,
         updated_at = now()
       RETURNING *`,
      [tenantId, input.productSku, stockPolicy, baseUnit, displayUnit, displayPrecision,
        lotTracking, expiryTracking, fefo, kitchenStation, scaleItemCode, scaleSize]
    );
    if (product.rows[0].active) {
      const readiness = await getProductReadinessInTx(client, tenantId, input.productSku);
      if (!readiness.ready) {
        throw new Error(`สินค้าที่เปิดขายต้องผ่าน readiness: ${readiness.blockers.map((issue) => issue.message).join("; ")}`);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
  const saved = await getProductStockPolicy(tenantId, input.productSku);
  if (!saved) throw new Error("ไม่พบนโยบาย Stock หลังบันทึก");
  return saved;
}
