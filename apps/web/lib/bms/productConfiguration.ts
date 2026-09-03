import { getClient, query } from "@/lib/db";
import type { QueryResult, QueryResultRow } from "pg";
import { beginTenantTx } from "./tenant";
import { isCapabilityEnabledInTx } from "./storeCapabilities";
import { enforceProductQuota } from "./plans";
import {
  PRODUCT_SALES_SURFACES,
  productTemplateDefaults,
  type ProductSalesSurface,
} from "./productTemplatePresets";

export { PRODUCT_SALES_SURFACES, productTemplateDefaults } from "./productTemplatePresets";
export type { ProductSalesSurface } from "./productTemplatePresets";

export type ProductCatalogVariant = {
  code: string;
  displayName: string | null;
  active: boolean;
  sortOrder: number;
};

export type ProductReadinessIssue = {
  code: string;
  message: string;
  field: string | null;
  /**
   * `true` = แก้ที่ฟอร์มสินค้าไม่ได้ ต้องไปทำที่หน้าอื่น (เช่น นโยบายสินค้าของร้านยา
   * ที่ต้องผ่านการอนุมัติของเภสัชกร)
   *
   * ทำไมต้องแยกออกมา: `upsertProduct()` ปฏิเสธการบันทึกสินค้าที่ active เมื่อ readiness
   * ไม่ผ่าน ซึ่งถูกสำหรับข้อที่แก้ได้ในฟอร์มเดียวกัน แต่ถ้าเป็นข้อที่แก้ที่นี่ไม่ได้
   * ร้านยาที่มีสินค้าเปิดขายอยู่แล้วจะ **แก้ชื่อสินค้าตัวเองไม่ได้เลยทั้งร้าน**
   * จนกว่าจะไปเดิน workflow อนุมัติให้ครบทุก SKU · ข้อพวกนี้จึงยังบล็อก "การเปิดขาย"
   * (publishProduct) เหมือนเดิม แต่ไม่บล็อก "การบันทึกข้อมูลอื่นของสินค้าที่เปิดขายอยู่แล้ว"
   */
  external?: boolean;
  /** หน้าที่แก้ข้อนี้ได้ — ให้ UI ยื่นลิงก์แทนที่จะให้ผู้ใช้ไปเดาเอง */
  fixPath?: string | null;
};

export type ProductReadiness = {
  ready: boolean;
  blockers: ProductReadinessIssue[];
  warnings: ProductReadinessIssue[];
  recipeCostEstimate: number | null;
  recipeCostMaxEstimate: number | null;
};

type QueryClient = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: any[]): Promise<QueryResult<T>>;
};

const SURFACE_SET = new Set<string>(PRODUCT_SALES_SURFACES);

/**
 * ด่าน "สินค้าที่เปิดขายอยู่แล้วต้องยังพร้อมขายหลังบันทึก" ที่ทุกเส้นทางเขียนใช้ร่วมกัน
 *
 * ตัด `external` ออกโดยตั้งใจ — ข้อที่แก้ที่หน้าอื่นไม่ควรทำให้ "แก้ชื่อสินค้า" ล้ม
 * (ร้านยาที่มีสินค้าเปิดขาย 500 ตัวจะแก้อะไรไม่ได้เลยทั้งร้าน) · การ **เปิดขาย**
 * ยังต้องผ่านทุกข้อ เพราะ publishProduct ใช้ `readiness.ready` ตรง ๆ ไม่ผ่านฟังก์ชันนี้
 */
export function assertReadinessAllowsSaveOfActiveProduct(readiness: ProductReadiness) {
  const blocking = readiness.blockers.filter((issue) => !issue.external);
  if (blocking.length === 0) return;
  throw new Error(`สินค้าที่เปิดขายต้องผ่าน readiness: ${blocking.map((issue) => issue.message).join("; ")}`);
}

/**
 * รหัสตัวเลือกคือ **ป้ายหน่วยขายที่ร้านพิมพ์เอง** ไม่ใช่ enum ภายใน — namespace เดียวกับ
 * `bms_inventory.size` / `bms_product_packs.size` / `bms_product_recipes.size` ซึ่งเป็น
 * free text มาตลอด (ของจริงในฐานมีทั้ง "60ml", "100 ml", "10 เม็ด", "1 ชุด")
 * และไมเกรชัน 9.51 ก็ยกค่าเดิมมาเป็น code แบบตรงตัว
 *
 * ⚠️ ห้ามกลับไป uppercase/บังคับ A-Z: ฟอร์มสินค้าเติม variantCodes จากค่าที่มีอยู่แล้ว
 * ส่งกลับมาตอนกดบันทึก ถ้าแปลงตัวพิมพ์ ("60ml" → "60ML") จะได้ตัวเลือกงอกใบใหม่คู่กับ
 * ของเดิม แล้ว readiness หา pack ของมันไม่เจอ (join ด้วย code ตรงตัว) → บันทึกไม่ได้
 * ส่วนไซซ์ภาษาไทยจะถูกปฏิเสธทั้งก้อน = เปิดสินค้ามากดบันทึกเฉย ๆ ก็ล้ม
 */
export function normalizeProductVariantCode(value: string): string {
  const code = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!code) throw new Error("ต้องระบุรหัสตัวเลือก");
  if (code.length > 64) throw new Error("รหัสตัวเลือกยาวได้ไม่เกิน 64 ตัวอักษร");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(code)) throw new Error("รหัสตัวเลือกมีอักขระควบคุมที่ใช้ไม่ได้");
  return code;
}

/** ตัวเลือกที่ต่างกันแค่ตัวพิมพ์คือตัวเดียวกัน — เส้นทางขายเทียบไซซ์ด้วย upper() อยู่แล้ว */
export function sameProductVariantCode(a: string, b: string): boolean {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

export function normalizeProductSalesSurfaces(values: readonly string[]): ProductSalesSurface[] {
  const normalized = Array.from(new Set(values.map((value) => String(value).trim().toUpperCase())));
  const invalid = normalized.find((value) => !SURFACE_SET.has(value));
  if (invalid) throw new Error(`ช่องทางขายไม่ถูกต้อง: ${invalid}`);
  return normalized as ProductSalesSurface[];
}

export async function listProductCatalogVariants(
  tenantId: string,
  productSku: string
): Promise<ProductCatalogVariant[]> {
  const result = await query<{
    code: string;
    display_name: string | null;
    active: boolean;
    sort_order: number;
  }>(
    `SELECT code, display_name, active, sort_order
       FROM bms_product_variants
      WHERE tenant_id = $1 AND product_sku = $2
      ORDER BY sort_order, code`,
    [tenantId, productSku]
  );
  return result.rows.map((row) => ({
    code: row.code,
    displayName: row.display_name,
    active: row.active,
    sortOrder: Number(row.sort_order),
  }));
}

export async function upsertProductCatalogVariant(
  tenantId: string,
  input: { productSku: string; code: string; displayName?: string | null; active?: boolean; sortOrder?: number | null },
  editorId?: string | null
): Promise<ProductCatalogVariant> {
  const productSku = String(input.productSku ?? "").trim();
  const code = normalizeProductVariantCode(input.code);
  const displayName = String(input.displayName ?? "").trim() || null;
  const sortOrder = Math.trunc(Number(input.sortOrder ?? 0));
  if (!productSku) throw new Error("ต้องระบุสินค้า");
  if (!Number.isSafeInteger(sortOrder)) throw new Error("ลำดับตัวเลือกไม่ถูกต้อง");

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, editorId ? { editorId } : undefined);
    const storedCode = await resolveStoredVariantCodeInTx(client, tenantId, productSku, code);
    const result = await client.query<{
      code: string; display_name: string | null; active: boolean; sort_order: number;
    }>(
      `INSERT INTO bms_product_variants
         (tenant_id, product_sku, code, display_name, active, sort_order)
       VALUES ($1,$2,$3,$4,COALESCE($5,TRUE),$6)
       ON CONFLICT (tenant_id, product_sku, code) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         active = COALESCE($5, bms_product_variants.active),
         sort_order = EXCLUDED.sort_order,
         updated_at = now()
       RETURNING code, display_name, active, sort_order`,
      [tenantId, productSku, storedCode, displayName, input.active ?? null, sortOrder]
    );
    const lifecycle = await client.query<{ active: boolean }>(
      `SELECT active FROM bms_products WHERE tenant_id = $1 AND sku = $2`,
      [tenantId, productSku]
    );
    if (lifecycle.rows[0]?.active) {
      const readiness = await getProductReadinessInTx(client, tenantId, productSku);
      assertReadinessAllowsSaveOfActiveProduct(readiness);
    }
    await client.query("COMMIT");
    const row = result.rows[0];
    return { code: row.code, displayName: row.display_name, active: row.active, sortOrder: Number(row.sort_order) };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/**
 * คืนสะกดที่เก็บอยู่จริงถ้ามีตัวเลือกที่ต่างกันแค่ตัวพิมพ์ — พิมพ์ "std" ตอนที่ร้านมี "STD"
 * ต้องไปแก้แถวเดิม ไม่ใช่งอกตัวเลือกใบที่สองที่ไม่มีสต็อก/ไม่มีราคาผูกไว้
 */
export async function resolveStoredVariantCodeInTx(
  client: QueryClient,
  tenantId: string,
  productSku: string,
  code: string
): Promise<string> {
  const existing = await client.query<{ code: string }>(
    `SELECT code FROM bms_product_variants
      WHERE tenant_id = $1 AND product_sku = $2 AND lower(code) = lower($3)
      LIMIT 1`,
    [tenantId, productSku, code]
  );
  return existing.rows[0]?.code ?? code;
}

export async function listProductSalesSurfaces(
  tenantId: string,
  productSku: string
): Promise<ProductSalesSurface[]> {
  const result = await query<{ surface: ProductSalesSurface }>(
    `SELECT surface
       FROM bms_product_sales_surfaces
      WHERE tenant_id = $1 AND product_sku = $2 AND enabled
      ORDER BY surface`,
    [tenantId, productSku]
  );
  return result.rows.map((row) => row.surface);
}

export async function setProductSalesSurfaces(
  tenantId: string,
  productSkuInput: string,
  surfacesInput: readonly string[],
  editorId?: string | null
): Promise<ProductSalesSurface[]> {
  const productSku = String(productSkuInput ?? "").trim();
  const surfaces = normalizeProductSalesSurfaces(surfacesInput);
  if (!productSku) throw new Error("ต้องระบุสินค้า");
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, editorId ? { editorId } : undefined);
    const owned = await client.query(
      `SELECT 1 FROM bms_products WHERE tenant_id = $1 AND sku = $2 FOR UPDATE`,
      [tenantId, productSku]
    );
    if (!owned.rowCount) throw new Error("ไม่พบสินค้านี้ในร้าน");
    await client.query(
      `UPDATE bms_product_sales_surfaces
          SET enabled = FALSE, updated_at = now()
        WHERE tenant_id = $1 AND product_sku = $2`,
      [tenantId, productSku]
    );
    for (const surface of surfaces) {
      await client.query(
        `INSERT INTO bms_product_sales_surfaces (tenant_id, product_sku, surface, enabled)
         VALUES ($1,$2,$3,TRUE)
         ON CONFLICT (tenant_id, product_sku, surface) DO UPDATE SET
           enabled = TRUE, updated_at = now()`,
        [tenantId, productSku, surface]
      );
    }
    const lifecycle = await client.query<{ active: boolean }>(
      `SELECT active FROM bms_products WHERE tenant_id = $1 AND sku = $2`,
      [tenantId, productSku]
    );
    if (lifecycle.rows[0]?.active) {
      const readiness = await getProductReadinessInTx(client, tenantId, productSku);
      assertReadinessAllowsSaveOfActiveProduct(readiness);
    }
    await client.query("COMMIT");
    return surfaces;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function getProductReadinessInTx(
  client: QueryClient,
  tenantId: string,
  productSku: string
): Promise<ProductReadiness> {
  const productResult = await client.query<{
    price: string;
    vat_category: string;
    stock_policy: string | null;
    kitchen_station: string | null;
    vat_registered: boolean;
    is_bundle: boolean;
    serial_tracked: boolean;
    base_unit: string | null;
    scale_item_code: string | null;
    scale_size: string | null;
    business_archetype: string | null;
  }>(
    `SELECT p.price, p.vat_category, p.is_bundle, p.serial_tracked,
            policy.stock_policy, policy.kitchen_station, policy.base_unit,
            policy.scale_item_code, policy.scale_size,
            COALESCE(profile.vat_registered, FALSE) AS vat_registered,
            profile.business_archetype
       FROM bms_products p
       LEFT JOIN bms_product_stock_policies policy
         ON policy.tenant_id = p.tenant_id AND policy.product_sku = p.sku
       LEFT JOIN bms_store_profile profile ON profile.tenant_id = p.tenant_id
      WHERE p.tenant_id = $1 AND p.sku = $2`,
    [tenantId, productSku]
  );
  const product = productResult.rows[0];
  if (!product) throw new Error("ไม่พบสินค้านี้ในร้าน");

  const [variantsResult, surfacesResult, recipesResult, modifiersResult, packsResult, bundleResult, costResult] = await Promise.all([
    client.query<{ code: string; effective_price: string }>(
      `SELECT variant.code, COALESCE(sized.price, shared.price, product.price)::text AS effective_price
         FROM bms_product_variants variant
         JOIN bms_products product
           ON product.tenant_id = variant.tenant_id AND product.sku = variant.product_sku
         LEFT JOIN bms_product_packs sized
           ON sized.tenant_id = variant.tenant_id AND sized.product_sku = variant.product_sku
          AND sized.size = variant.code AND sized.is_base AND sized.active
         LEFT JOIN bms_product_packs shared
           ON shared.tenant_id = variant.tenant_id AND shared.product_sku = variant.product_sku
          AND shared.size IS NULL AND shared.is_base AND shared.active
        WHERE variant.tenant_id = $1 AND variant.product_sku = $2 AND variant.active
        ORDER BY variant.sort_order, variant.code`,
      [tenantId, productSku]
    ),
    client.query<{ surface: ProductSalesSurface }>(
      `SELECT surface FROM bms_product_sales_surfaces
        WHERE tenant_id = $1 AND product_sku = $2 AND enabled`,
      [tenantId, productSku]
    ),
    client.query<{ size: string }>(
      `SELECT r.size
         FROM bms_product_recipes r
        WHERE r.tenant_id = $1 AND r.product_sku = $2 AND r.active
          AND EXISTS (
            SELECT 1 FROM bms_product_recipe_items item
             WHERE item.tenant_id = r.tenant_id AND item.recipe_id = r.id
          )`,
      [tenantId, productSku]
    ),
    client.query<{ size: string; count: number }>(
      `SELECT size, COUNT(*)::int AS count
         FROM bms_product_modifiers
        WHERE tenant_id = $1 AND product_sku = $2 AND active
        GROUP BY size`,
      [tenantId, productSku]
    ),
    client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM bms_product_packs
        WHERE tenant_id = $1 AND product_sku = $2 AND active AND NOT is_base`,
      [tenantId, productSku]
    ),
    client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM bms_product_bundle_items
        WHERE tenant_id = $1 AND bundle_sku = $2`,
      [tenantId, productSku]
    ),
    client.query<{ recipe_cost: string | null; recipe_cost_max: string | null; missing_cost: number }>(
      `SELECT MIN(recipe_total)::text AS recipe_cost,
              MAX(recipe_total)::text AS recipe_cost_max,
              COALESCE(SUM(missing_cost), 0)::int AS missing_cost
         FROM (
           SELECT recipe.id,
                  SUM((item.qty::numeric / recipe.output_qty) * component.cost_price) AS recipe_total,
                  COUNT(*) FILTER (WHERE component.cost_price IS NULL)::int AS missing_cost
             FROM bms_product_recipes recipe
             JOIN bms_product_recipe_items item
               ON item.tenant_id = recipe.tenant_id AND item.recipe_id = recipe.id
             JOIN bms_products component
               ON component.tenant_id = item.tenant_id AND component.sku = item.component_sku
            WHERE recipe.tenant_id = $1 AND recipe.product_sku = $2 AND recipe.active
            GROUP BY recipe.id
         ) recipe_costs`,
      [tenantId, productSku]
    ),
  ]);

  const blockers: ProductReadinessIssue[] = [];
  const warnings: ProductReadinessIssue[] = [];
  const variants = variantsResult.rows.map((row) => row.code);
  const surfaces = new Set(surfacesResult.rows.map((row) => row.surface));
  const recipes = new Set(recipesResult.rows.map((row) => row.size));
  const policy = product.stock_policy ?? "DIRECT";

  if (variants.length === 0) {
    blockers.push({ code: "VARIANT_REQUIRED", message: "ต้องมีตัวเลือกหรือหน่วยขายอย่างน้อย 1 รายการ", field: "variants" });
  }
  if (surfaces.size > 0 && variants.length === 0 && Number(product.price) <= 0) {
    blockers.push({ code: "SELLING_PRICE_REQUIRED", message: "สินค้าที่เปิดช่องทางขายต้องมีราคามากกว่า 0", field: "price" });
  }
  for (const variant of variantsResult.rows) {
    if (surfaces.size > 0 && Number(variant.effective_price) <= 0) {
      blockers.push({ code: "VARIANT_PRICE_REQUIRED", message: `ราคาขายของ ${variant.code} ต้องมากกว่า 0`, field: "price" });
    }
  }
  if (product.vat_registered && product.vat_category === "UNKNOWN" && surfaces.size > 0) {
    blockers.push({ code: "VAT_CATEGORY_REQUIRED", message: "ร้านจด VAT ต้องระบุประเภท VAT ก่อนเปิดขาย", field: "vatCategory" });
  }

  if (policy === "RECIPE") {
    if (!(await isCapabilityEnabledInTx(client, tenantId, "RECIPE"))) {
      blockers.push({ code: "RECIPE_CAPABILITY_DISABLED", message: "ต้องเปิดความสามารถ Recipe ก่อนเปิดขายเมนู", field: "stockPolicy" });
    }
    for (const variant of variants) {
      if (!recipes.has(variant)) {
        blockers.push({ code: "RECIPE_REQUIRED", message: `ยังไม่มีสูตรที่เปิดใช้สำหรับ ${variant}`, field: "recipes" });
      }
    }
  } else if (modifiersResult.rows.length > 0) {
    blockers.push({ code: "MODIFIER_REQUIRES_RECIPE", message: "Modifier ใช้ได้เฉพาะสินค้า RECIPE", field: "modifiers" });
  }

  if (modifiersResult.rows.length > 0 && !(await isCapabilityEnabledInTx(client, tenantId, "MODIFIER"))) {
    blockers.push({ code: "MODIFIER_CAPABILITY_DISABLED", message: "ต้องเปิดความสามารถ Modifier ก่อนเปิดใช้ตัวเลือกเมนู", field: "modifiers" });
  }
  if (policy === "PACK" && Number(packsResult.rows[0]?.count ?? 0) === 0) {
    blockers.push({ code: "PACK_REQUIRED", message: "สินค้า PACK ต้องมีหน่วยขายแบบแพ็กอย่างน้อย 1 รายการ", field: "packs" });
  }
  if (policy === "BUNDLE" && (!product.is_bundle || Number(bundleResult.rows[0]?.count ?? 0) === 0)) {
    blockers.push({ code: "BUNDLE_REQUIRED", message: "สินค้า BUNDLE ต้องเปิดสถานะชุดและมีส่วนประกอบอย่างน้อย 1 รายการ", field: "bundle" });
  }
  if (policy === "SERIALIZED" && !product.serial_tracked) {
    blockers.push({ code: "SERIAL_TRACKING_REQUIRED", message: "สินค้า SERIALIZED ต้องเปิด Serial tracking", field: "serialTracked" });
  }
  if (policy === "WEIGHTED") {
    if (!(await isCapabilityEnabledInTx(client, tenantId, "WEIGHTED_PRODUCT"))) {
      blockers.push({ code: "WEIGHTED_CAPABILITY_DISABLED", message: "ต้องเปิดความสามารถสินค้าชั่งน้ำหนักก่อนเปิดขาย", field: "stockPolicy" });
    }
    if (product.base_unit !== "GRAM") {
      blockers.push({ code: "WEIGHTED_BASE_UNIT_REQUIRED", message: "สินค้าชั่งน้ำหนักต้องใช้หน่วยฐาน GRAM", field: "baseUnit" });
    }
    if (surfaces.has("RETAIL_POS") && (!product.scale_item_code || !product.scale_size)) {
      warnings.push({ code: "SCALE_MAPPING_MISSING", message: "ยังไม่ได้ผูกรหัสเครื่องชั่ง จึงขายได้ด้วยการเลือกสินค้าแต่ยิงฉลากเครื่องชั่งไม่ได้", field: "scaleItemCode" });
    }
  }
  if (surfaces.has("RESTAURANT_POS") && !product.kitchen_station) {
    warnings.push({ code: "KITCHEN_STATION_MISSING", message: "ยังไม่ระบุ Kitchen station รายการจะไปช่องไม่ระบุสถานี", field: "kitchenStation" });
  }
  if (surfaces.size === 0) {
    warnings.push({ code: "NO_SALES_SURFACE", message: "รายการนี้ใช้ภายในร้านและยังไม่เปิดขายในช่องทางใด", field: "salesSurfaces" });
  }
  // ช่องทางที่ร้านนี้ไม่มีหน้าจอรองรับ = สินค้าที่มองไม่เห็นจากทุกที่ · `/pos/restaurant`
  // เรียก requireRestaurantTenant() และ `/pos` ค้าปลีกกรองด้วย RETAIL_POS ดังนั้น
  // RESTAURANT_POS ในร้านที่ไม่ใช่ร้านอาหารคือช่องทางที่ไม่มีใครเปิดได้
  if (surfaces.has("RESTAURANT_POS") && product.business_archetype !== "restaurant") {
    warnings.push({
      code: "SURFACE_NOT_SERVED",
      message: "เปิดช่องทาง Restaurant POS ไว้ แต่ร้านนี้ไม่ใช่ประเภทร้านอาหารจึงไม่มีหน้าจอนั้นให้ขาย",
      field: "salesSurfaces",
    });
  }

  // ร้านยา: ขายไม่ได้จนกว่านโยบายสินค้าจะ APPROVED — เงื่อนไขเดียวกับที่
  // evaluatePharmacySale() ใช้ปฏิเสธบิล (`!policy || policy.status !== 'APPROVED'`)
  // ก่อนหน้านี้ readiness ไม่รู้จักร้านยาเลย ฟอร์มจึงบอกว่า "พร้อมขาย" แล้วไปตายที่
  // เคาน์เตอร์กลางคิวลูกค้าด้วย PHARMACY_POLICY_UNKNOWN
  if (product.business_archetype === "pharmacy" && surfaces.size > 0) {
    const policyRow = await client.query<{ status: string }>(
      `SELECT status FROM bms_pharmacy_product_policies
        WHERE tenant_id = $1 AND product_sku = $2`,
      [tenantId, productSku]
    );
    const status = policyRow.rows[0]?.status ?? "MISSING";
    if (status !== "APPROVED") {
      blockers.push({
        code: "PHARMACY_POLICY_REQUIRED",
        message: status === "MISSING"
          ? "ร้านยาต้องมีนโยบายสินค้าที่เภสัชกรอนุมัติก่อนจึงจะขายได้"
          : `นโยบายสินค้ายังอยู่สถานะ ${status} — ต้องผ่านการอนุมัติของเภสัชกรก่อนจึงจะขายได้`,
        field: "pharmacyPolicy",
        // แก้ที่ฟอร์มสินค้าไม่ได้ ต้องเดิน workflow ที่หน้านโยบายสินค้า
        external: true,
        fixPath: "/admin/pharmacy-protocols",
      });
    }
  }

  const cost = costResult.rows[0];
  const recipeCostEstimate = cost?.recipe_cost != null && Number(cost.missing_cost) === 0
    ? Math.round(Number(cost.recipe_cost) * 100) / 100
    : null;
  const recipeCostMaxEstimate = cost?.recipe_cost_max != null && Number(cost.missing_cost) === 0
    ? Math.round(Number(cost.recipe_cost_max) * 100) / 100
    : null;
  if (policy === "RECIPE" && cost && Number(cost.missing_cost) > 0) {
    warnings.push({ code: "RECIPE_COST_INCOMPLETE", message: "ยังคำนวณต้นทุนสูตรไม่ได้ เพราะวัตถุดิบบางรายการไม่มีต้นทุน", field: "costPrice" });
  }

  return { ready: blockers.length === 0, blockers, warnings, recipeCostEstimate, recipeCostMaxEstimate };
}

export async function getProductReadiness(tenantId: string, productSku: string): Promise<ProductReadiness> {
  return getProductReadinessInTx({ query }, tenantId, productSku);
}

export async function publishProduct(
  tenantId: string,
  productSku: string,
  editorId?: string | null
): Promise<ProductReadiness> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, editorId ? { editorId } : undefined);
    const locked = await client.query(
      `SELECT 1 FROM bms_products WHERE tenant_id = $1 AND sku = $2 FOR UPDATE`,
      [tenantId, productSku]
    );
    if (!locked.rowCount) throw new Error("ไม่พบสินค้านี้ในร้าน");
    const readiness = await getProductReadinessInTx(client, tenantId, productSku);
    if (!readiness.ready) {
      throw new Error(`สินค้ายังไม่พร้อมเปิดขาย: ${readiness.blockers.map((issue) => issue.message).join("; ")}`);
    }
    await client.query(
      `UPDATE bms_products SET active = TRUE, updated_at = now()
        WHERE tenant_id = $1 AND sku = $2`,
      [tenantId, productSku]
    );
    await client.query("COMMIT");
    return readiness;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Clone catalog configuration as one draft. Inventory, reservations, serials,
 * lots and barcodes are deliberately not copied: they are physical facts, not
 * reusable menu configuration.
 */
export async function duplicateProductConfiguration(
  tenantId: string,
  sourceSkuRaw: string,
  targetSkuRaw: string,
  targetNameRaw: string,
  editorId?: string | null
): Promise<{ sku: string; name: string }> {
  const sourceSku = String(sourceSkuRaw ?? "").trim();
  const targetSku = String(targetSkuRaw ?? "").trim();
  const targetName = String(targetNameRaw ?? "").trim();
  if (!sourceSku || !targetSku || !targetName) throw new Error("ต้องระบุ SKU ต้นทาง, SKU ใหม่ และชื่อสินค้า");
  if (sourceSku === targetSku) throw new Error("SKU ใหม่ต้องไม่ซ้ำกับสินค้าต้นทาง");

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, editorId ? { editorId } : undefined);
    await client.query(`SELECT id FROM bms_tenants WHERE id = $1 FOR UPDATE`, [tenantId]);
    await enforceProductQuota(tenantId, client);

    const inserted = await client.query<{ sku: string; name: string }>(
      // `serial_tracked` ตามมาด้วยเพราะสำเนายก stock policy มาทั้งชุด: สำเนาของสินค้า
      // SERIALIZED ที่ไม่ได้ยกธงนี้มาจะเป็นฉบับร่างที่เปิดขายไม่ได้ (readiness ค้างที่
      // SERIAL_TRACKING_REQUIRED) และไม่มีหน้าไหนในแอปเปิดธงนี้ให้ได้ · เลขเครื่องรายชิ้น
      // (bms_product_serials) ยังไม่ถูกคัดลอกตามเดิม — มันคือของจริงชิ้นเดียวในโลก
      `INSERT INTO bms_products
         (tenant_id, sku, name, active, price, keywords, barcode, image_url, description,
          cost_price, category, brand, weight_grams, vat_category, is_bundle, serial_tracked)
       SELECT tenant_id, $3, $4, FALSE, price, keywords, NULL, image_url, description,
              cost_price, category, brand, weight_grams, vat_category, is_bundle, serial_tracked
         FROM bms_products
        WHERE tenant_id = $1 AND sku = $2
       RETURNING sku, name`,
      [tenantId, sourceSku, targetSku, targetName]
    );
    if (!inserted.rows[0]) throw new Error("ไม่พบสินค้าต้นทาง");

    await client.query(
      `INSERT INTO bms_product_images (tenant_id, product_sku, file_id, sort_order)
       SELECT tenant_id, $3, file_id, sort_order FROM bms_product_images
        WHERE tenant_id = $1 AND product_sku = $2`,
      [tenantId, sourceSku, targetSku]
    );
    await client.query(
      `INSERT INTO bms_product_variants (tenant_id, product_sku, code, display_name, active, sort_order)
       SELECT tenant_id, $3, code, display_name, active, sort_order FROM bms_product_variants
        WHERE tenant_id = $1 AND product_sku = $2`,
      [tenantId, sourceSku, targetSku]
    );
    await client.query(
      `INSERT INTO bms_product_sales_surfaces (tenant_id, product_sku, surface, enabled)
       SELECT tenant_id, $3, surface, enabled FROM bms_product_sales_surfaces
        WHERE tenant_id = $1 AND product_sku = $2`,
      [tenantId, sourceSku, targetSku]
    );
    await client.query(
      `INSERT INTO bms_product_stock_policies
         (tenant_id, product_sku, stock_policy, base_unit, display_unit, display_precision,
          lot_tracking, expiry_tracking, fefo, kitchen_station, scale_item_code, scale_size)
       SELECT tenant_id, $3, stock_policy, base_unit, display_unit, display_precision,
              lot_tracking, expiry_tracking, fefo, kitchen_station, NULL, NULL
         FROM bms_product_stock_policies
        WHERE tenant_id = $1 AND product_sku = $2`,
      [tenantId, sourceSku, targetSku]
    );
    await client.query(
      `INSERT INTO bms_product_price_tiers
         (tenant_id, product_sku, min_qty, unit_price, note, scope, size, discount_pct)
       SELECT tenant_id, $3, min_qty, unit_price, note, scope, size, discount_pct
         FROM bms_product_price_tiers
        WHERE tenant_id = $1 AND product_sku = $2`,
      [tenantId, sourceSku, targetSku]
    );
    await client.query(
      `INSERT INTO bms_product_packs
         (tenant_id, product_sku, size, pack_code, unit_name, base_qty, barcode, price, is_base, active)
       SELECT tenant_id, $3, size, pack_code, unit_name, base_qty, NULL, price, is_base, active
         FROM bms_product_packs
        WHERE tenant_id = $1 AND product_sku = $2`,
      [tenantId, sourceSku, targetSku]
    );

    const recipes = await client.query<{ id: string; size: string; version: number; output_qty: number; active: boolean }>(
      `SELECT id, size, version, output_qty, active FROM bms_product_recipes
        WHERE tenant_id = $1 AND product_sku = $2 ORDER BY size, version`,
      [tenantId, sourceSku]
    );
    for (const recipe of recipes.rows) {
      const cloned = await client.query<{ id: string }>(
        `INSERT INTO bms_product_recipes (tenant_id, product_sku, size, version, output_qty, active)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [tenantId, targetSku, recipe.size, recipe.version, recipe.output_qty, recipe.active]
      );
      await client.query(
        `INSERT INTO bms_product_recipe_items (tenant_id, recipe_id, component_sku, component_size, qty)
         SELECT tenant_id, $3, component_sku, component_size, qty
           FROM bms_product_recipe_items WHERE tenant_id = $1 AND recipe_id = $2`,
        [tenantId, recipe.id, cloned.rows[0]!.id]
      );
    }

    const groups = await client.query<{
      id: string; size: string; code: string; name: string; selection_type: string;
      min_select: number; max_select: number | null; sort_order: number; active: boolean;
    }>(
      `SELECT id, size, code, name, selection_type, min_select, max_select, sort_order, active
         FROM bms_product_modifier_groups
        WHERE tenant_id = $1 AND product_sku = $2 ORDER BY sort_order, code`,
      [tenantId, sourceSku]
    );
    for (const group of groups.rows) {
      const clonedGroup = await client.query<{ id: string }>(
        `INSERT INTO bms_product_modifier_groups
           (tenant_id, product_sku, size, code, name, selection_type, min_select, max_select, sort_order, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [tenantId, targetSku, group.size, group.code, group.name, group.selection_type,
          group.min_select, group.max_select, group.sort_order, group.active]
      );
      const modifiers = await client.query<{
        id: string; size: string; code: string; name: string; price_delta: string;
        active: boolean; default_selected: boolean; sort_order: number;
      }>(
        `SELECT id, size, code, name, price_delta, active, default_selected, sort_order
           FROM bms_product_modifiers
          WHERE tenant_id = $1 AND product_sku = $2 AND group_id = $3`,
        [tenantId, sourceSku, group.id]
      );
      for (const modifier of modifiers.rows) {
        const clonedModifier = await client.query<{ id: string }>(
          `INSERT INTO bms_product_modifiers
             (tenant_id, product_sku, size, code, name, price_delta, active, group_id, default_selected, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [tenantId, targetSku, modifier.size, modifier.code, modifier.name, modifier.price_delta,
            modifier.active, clonedGroup.rows[0]!.id, modifier.default_selected, modifier.sort_order]
        );
        await client.query(
          `INSERT INTO bms_product_modifier_items
             (tenant_id, modifier_id, component_sku, component_size, qty_delta)
           SELECT tenant_id, $3, component_sku, component_size, qty_delta
             FROM bms_product_modifier_items WHERE tenant_id = $1 AND modifier_id = $2`,
          [tenantId, modifier.id, clonedModifier.rows[0]!.id]
        );
      }
    }

    await client.query("COMMIT");
    return inserted.rows[0];
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
