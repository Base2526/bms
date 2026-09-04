import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { assertReadinessAllowsSaveOfActiveProduct, getProductReadinessInTx } from "./productConfiguration";

export type RecipeComponentInput = { sku: string; size: string; qty: number };
export type ProductRecipe = {
  id: string;
  productSku: string;
  size: string;
  version: number;
  outputQty: number;
  active: boolean;
  items: RecipeComponentInput[];
};

function normalizeComponents(items: RecipeComponentInput[]): RecipeComponentInput[] {
  const normalized = items.map((item) => ({
    sku: String(item.sku ?? "").trim(),
    size: String(item.size ?? "").trim(),
    qty: Math.trunc(Number(item.qty)),
  }));
  if (normalized.length === 0) throw new Error("สูตรต้องมีวัตถุดิบอย่างน้อย 1 รายการ");
  const keys = new Set<string>();
  for (const item of normalized) {
    if (!item.sku || !item.size || !Number.isSafeInteger(item.qty) || item.qty <= 0) {
      throw new Error("วัตถุดิบและจำนวนหน่วยฐานไม่ถูกต้อง");
    }
    const key = `${item.sku}\u0000${item.size}`;
    if (keys.has(key)) throw new Error(`วัตถุดิบซ้ำในสูตร: ${item.sku} (${item.size})`);
    keys.add(key);
  }
  return normalized;
}

export async function listProductRecipes(
  tenantId: string,
  productSku: string,
  size?: string | null
): Promise<ProductRecipe[]> {
  const result = await query<any>(
    `SELECT r.id, r.product_sku, r.size, r.version, r.output_qty, r.active,
            COALESCE(jsonb_agg(jsonb_build_object(
              'sku', ri.component_sku, 'size', ri.component_size, 'qty', ri.qty
            ) ORDER BY ri.component_sku, ri.component_size)
            FILTER (WHERE ri.id IS NOT NULL), '[]'::jsonb) AS items
       FROM bms_product_recipes r
       LEFT JOIN bms_product_recipe_items ri
         ON ri.tenant_id = r.tenant_id AND ri.recipe_id = r.id
      WHERE r.tenant_id = $1 AND r.product_sku = $2
        AND ($3::text IS NULL OR r.size = $3)
      GROUP BY r.id
      ORDER BY r.size, r.version DESC`,
    [tenantId, productSku, size ?? null]
  );
  return result.rows.map((row: any) => ({
    id: row.id,
    productSku: row.product_sku,
    size: row.size,
    version: Number(row.version),
    outputQty: Number(row.output_qty),
    active: Boolean(row.active),
    items: Array.isArray(row.items) ? row.items : [],
  }));
}

export async function upsertProductRecipe(
  tenantId: string,
  input: {
    id?: string | null;
    productSku: string;
    size: string;
    outputQty?: number | null;
    active?: boolean | null;
    items: RecipeComponentInput[];
  },
  editorId?: string | null
): Promise<ProductRecipe> {
  const productSku = String(input.productSku ?? "").trim();
  const size = String(input.size ?? "").trim();
  const outputQty = Math.trunc(Number(input.outputQty ?? 1));
  const items = normalizeComponents(input.items ?? []);
  if (!productSku || !size) throw new Error("ต้องระบุสินค้าและตัวเลือกของเมนู");
  if (!Number.isSafeInteger(outputQty) || outputQty <= 0) throw new Error("จำนวนผลผลิตต้องมากกว่า 0");
  if (items.some((item) => item.sku === productSku)) throw new Error("เมนูเป็นวัตถุดิบของตัวเองไม่ได้");

  const client = await getClient();
  let recipeId = input.id ?? null;
  try {
    await beginTenantTx(client, tenantId, editorId ? { editorId } : undefined);
    const owned = await client.query<{ active: boolean }>(
      `SELECT active FROM bms_products WHERE tenant_id = $1 AND sku = $2 FOR UPDATE`,
      [tenantId, productSku]
    );
    if (!owned.rowCount) throw new Error("ไม่พบเมนูนี้ในร้าน");
    if (recipeId) {
      const existing = await client.query<{ product_sku: string; size: string }>(
        `SELECT product_sku, size FROM bms_product_recipes
          WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, recipeId]
      );
      if (!existing.rowCount) throw new Error("ไม่พบสูตรนี้ในร้าน");
      if (existing.rows[0].product_sku !== productSku || existing.rows[0].size !== size) {
        throw new Error("ย้ายสูตรไปสินค้า/ตัวเลือกอื่นไม่ได้ ให้สร้าง version ใหม่");
      }
    }

    if (input.active) {
      await client.query(
        `UPDATE bms_product_recipes SET active = FALSE, updated_at = now()
          WHERE tenant_id = $1 AND product_sku = $2 AND size = $3
            AND ($4::uuid IS NULL OR id <> $4) AND active`,
        [tenantId, productSku, size, recipeId]
      );
    }
    const recipe = await client.query<{ id: string }>(
      `INSERT INTO bms_product_recipes
         (id, tenant_id, product_sku, size, version, output_qty, active)
       VALUES (
         COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4,
         COALESCE((SELECT max(version) + 1 FROM bms_product_recipes
                    WHERE tenant_id = $2 AND product_sku = $3 AND size = $4), 1),
         $5, COALESCE($6, FALSE)
       )
       ON CONFLICT (id) DO UPDATE SET
         output_qty = EXCLUDED.output_qty,
         active = COALESCE($6, bms_product_recipes.active), updated_at = now()
       RETURNING id`,
      [recipeId, tenantId, productSku, size, outputQty, input.active ?? null]
    );
    recipeId = recipe.rows[0].id;
    await client.query(
      `DELETE FROM bms_product_recipe_items WHERE tenant_id = $1 AND recipe_id = $2`,
      [tenantId, recipeId]
    );
    for (const item of items) {
      await client.query(
        `INSERT INTO bms_product_recipe_items
           (tenant_id, recipe_id, component_sku, component_size, qty)
         VALUES ($1,$2,$3,$4,$5)`,
        [tenantId, recipeId, item.sku, item.size, item.qty]
      );
    }
    await client.query(
      `INSERT INTO bms_product_stock_policies (tenant_id, product_sku, stock_policy)
       VALUES ($1,$2,'RECIPE')
       ON CONFLICT (tenant_id, product_sku) DO UPDATE SET
         stock_policy = 'RECIPE', updated_at = now()`,
      [tenantId, productSku]
    );
    if (owned.rows[0].active) {
      const readiness = await getProductReadinessInTx(client, tenantId, productSku);
      assertReadinessAllowsSaveOfActiveProduct(readiness);
    }
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
  const saved = (await listProductRecipes(tenantId, productSku, size))
    .find((recipe) => recipe.id === recipeId);
  if (!saved) throw new Error("ไม่พบสูตรหลังบันทึก");
  return saved;
}

export type ProductModifier = {
  id: string;
  productSku: string;
  size: string;
  code: string;
  name: string;
  priceDelta: number;
  active: boolean;
  groupId: string;
  groupCode: string;
  groupName: string;
  selectionType: "SINGLE" | "MULTIPLE";
  minSelect: number;
  maxSelect: number | null;
  defaultSelected: boolean;
  sortOrder: number;
  items: Array<{ sku: string; size: string; qtyDelta: number }>;
};

export async function listProductModifiers(
  tenantId: string,
  productSku: string,
  size?: string | null
): Promise<ProductModifier[]> {
  const result = await query<any>(
    `SELECT m.id, m.product_sku, m.size, m.code, m.name, m.price_delta, m.active,
            m.default_selected, m.sort_order, g.id AS group_id, g.code AS group_code,
            g.name AS group_name, g.selection_type, g.min_select, g.max_select,
            COALESCE(jsonb_agg(jsonb_build_object(
              'sku', mi.component_sku, 'size', mi.component_size, 'qtyDelta', mi.qty_delta
            ) ORDER BY mi.component_sku, mi.component_size)
            FILTER (WHERE mi.id IS NOT NULL), '[]'::jsonb) AS items
       FROM bms_product_modifiers m
       JOIN bms_product_modifier_groups g
         ON g.tenant_id = m.tenant_id AND g.id = m.group_id
       LEFT JOIN bms_product_modifier_items mi
         ON mi.tenant_id = m.tenant_id AND mi.modifier_id = m.id
      WHERE m.tenant_id = $1 AND m.product_sku = $2
        AND ($3::text IS NULL OR m.size = $3)
      GROUP BY m.id, g.id
      ORDER BY m.size, g.sort_order, m.sort_order, m.code`,
    [tenantId, productSku, size ?? null]
  );
  return result.rows.map((row: any) => ({
    id: row.id,
    productSku: row.product_sku,
    size: row.size,
    code: row.code,
    name: row.name,
    priceDelta: Number(row.price_delta ?? 0),
    active: Boolean(row.active),
    groupId: row.group_id,
    groupCode: row.group_code,
    groupName: row.group_name,
    selectionType: row.selection_type,
    minSelect: Number(row.min_select),
    maxSelect: row.max_select == null ? null : Number(row.max_select),
    defaultSelected: Boolean(row.default_selected),
    sortOrder: Number(row.sort_order),
    items: Array.isArray(row.items) ? row.items : [],
  }));
}

export async function upsertProductModifier(
  tenantId: string,
  input: {
    id?: string | null;
    productSku: string;
    size: string;
    code: string;
    name: string;
    priceDelta?: number | null;
    active?: boolean | null;
    groupCode?: string | null;
    groupName?: string | null;
    selectionType?: "SINGLE" | "MULTIPLE" | null;
    minSelect?: number | null;
    maxSelect?: number | null;
    defaultSelected?: boolean | null;
    sortOrder?: number | null;
    items: Array<{ sku: string; size: string; qtyDelta: number }>;
  },
  editorId?: string | null
): Promise<ProductModifier> {
  const productSku = String(input.productSku ?? "").trim();
  const size = String(input.size ?? "").trim();
  const code = String(input.code ?? "").trim().toUpperCase();
  const name = String(input.name ?? "").trim();
  const priceDelta = Math.round(Number(input.priceDelta ?? 0) * 100) / 100;
  const groupCode = String(input.groupCode ?? "OPTIONS").trim().toUpperCase();
  const groupName = String(input.groupName ?? "Options").trim();
  const selectionTypeRaw = String(input.selectionType ?? "MULTIPLE").trim().toUpperCase();
  if (selectionTypeRaw !== "SINGLE" && selectionTypeRaw !== "MULTIPLE") {
    throw new Error("ประเภทการเลือก Modifier ไม่ถูกต้อง");
  }
  const selectionType = selectionTypeRaw as "SINGLE" | "MULTIPLE";
  const minSelect = Number(input.minSelect ?? 0);
  const maxSelect = selectionType === "SINGLE"
    ? 1
    : input.maxSelect == null ? null : Number(input.maxSelect);
  const sortOrder = Number(input.sortOrder ?? 0);
  const items = (input.items ?? []).map((item) => ({
    sku: String(item.sku ?? "").trim(),
    size: String(item.size ?? "").trim(),
    qtyDelta: Math.trunc(Number(item.qtyDelta)),
  }));
  if (!productSku || !size || !code || !name) throw new Error("ข้อมูล Modifier ไม่ครบ");
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(groupCode) || !groupName) throw new Error("ข้อมูลกลุ่ม Modifier ไม่ถูกต้อง");
  if (!Number.isSafeInteger(minSelect) || minSelect < 0
    || (maxSelect != null && (!Number.isSafeInteger(maxSelect) || maxSelect <= 0 || minSelect > maxSelect))) {
    throw new Error("จำนวนตัวเลือกขั้นต่ำ/สูงสุดไม่ถูกต้อง");
  }
  if (!Number.isSafeInteger(sortOrder)) throw new Error("ลำดับ Modifier ไม่ถูกต้อง");
  if (!Number.isFinite(priceDelta) || priceDelta < 0 || priceDelta > 9999999999.99) {
    throw new Error("ราคาเพิ่มของ Modifier ต้องเป็นจำนวนตั้งแต่ 0 ขึ้นไป");
  }
  if (items.some((item) =>
    !item.sku || !item.size || !Number.isSafeInteger(item.qtyDelta) || item.qtyDelta === 0
  )) throw new Error("ผลกระทบวัตถุดิบของ Modifier ไม่ถูกต้อง");
  if (new Set(items.map((item) => `${item.sku}\u0000${item.size}`)).size !== items.length) {
    throw new Error("วัตถุดิบซ้ำใน Modifier");
  }

  const client = await getClient();
  let modifierId = input.id ?? null;
  try {
    await beginTenantTx(client, tenantId, editorId ? { editorId } : undefined);
    const policy = await client.query<{ stock_policy: string | null }>(
      `SELECT stock_policy FROM bms_product_stock_policies
        WHERE tenant_id = $1 AND product_sku = $2 FOR UPDATE`,
      [tenantId, productSku]
    );
    // A modifier without ingredient rows is a preparation instruction or price-only option.
    // It is valid for every policy; only a stock-affecting modifier needs a recipe.
    if (items.length > 0 && policy.rows[0]?.stock_policy !== "RECIPE") {
      throw new Error("Modifier ที่มีผลต่อวัตถุดิบใช้ได้เฉพาะสินค้าที่มี Stock Policy เป็น RECIPE");
    }
    if (modifierId) {
      const existing = await client.query<{ product_sku: string }>(
        `SELECT product_sku FROM bms_product_modifiers
          WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, modifierId]
      );
      if (!existing.rowCount) throw new Error("ไม่พบ Modifier นี้ในร้าน");
      if (existing.rows[0].product_sku !== productSku) {
        throw new Error("ย้าย Modifier ไปสินค้าอื่นไม่ได้");
      }
    }
    const group = await client.query<{ id: string }>(
      `INSERT INTO bms_product_modifier_groups
         (tenant_id, product_sku, size, code, name, selection_type, min_select, max_select)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_id, product_sku, size, code) DO UPDATE SET
         name = EXCLUDED.name, selection_type = EXCLUDED.selection_type,
         min_select = EXCLUDED.min_select, max_select = EXCLUDED.max_select,
         active = TRUE, updated_at = now()
       RETURNING id`,
      [tenantId, productSku, size, groupCode, groupName, selectionType, minSelect, maxSelect]
    );
    const groupId = group.rows[0].id;
    const modifier = await client.query<{ id: string }>(
      `INSERT INTO bms_product_modifiers
         (id, tenant_id, product_sku, size, code, name, price_delta, active,
          group_id, default_selected, sort_order)
       VALUES (COALESCE($1::uuid, gen_random_uuid()),$2,$3,$4,$5,$6,$7,COALESCE($8,TRUE),$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET
         size = EXCLUDED.size, code = EXCLUDED.code, name = EXCLUDED.name,
         price_delta = EXCLUDED.price_delta,
         active = COALESCE($8, bms_product_modifiers.active), group_id = EXCLUDED.group_id,
         default_selected = EXCLUDED.default_selected, sort_order = EXCLUDED.sort_order,
         updated_at = now()
       RETURNING id`,
      [modifierId, tenantId, productSku, size, code, name, priceDelta, input.active ?? null,
        groupId, Boolean(input.defaultSelected), sortOrder]
    );
    modifierId = modifier.rows[0].id;
    await client.query(
      `DELETE FROM bms_product_modifier_items WHERE tenant_id = $1 AND modifier_id = $2`,
      [tenantId, modifierId]
    );
    for (const item of items) {
      await client.query(
        `INSERT INTO bms_product_modifier_items
           (tenant_id, modifier_id, component_sku, component_size, qty_delta)
         VALUES ($1,$2,$3,$4,$5)`,
        [tenantId, modifierId, item.sku, item.size, item.qtyDelta]
      );
    }
    const groupState = await client.query<{ selected_count: number; option_count: number }>(
      `SELECT COUNT(*) FILTER (WHERE active AND default_selected)::int AS selected_count,
              COUNT(*) FILTER (WHERE active)::int AS option_count
         FROM bms_product_modifiers
        WHERE tenant_id = $1 AND group_id = $2`,
      [tenantId, groupId]
    );
    const selectedCount = Number(groupState.rows[0]?.selected_count ?? 0);
    const optionCount = Number(groupState.rows[0]?.option_count ?? 0);
    if (selectedCount > (maxSelect ?? optionCount)) throw new Error("ค่าเริ่มต้นของกลุ่ม Modifier เกินจำนวนที่เลือกได้");
    if (minSelect > optionCount) throw new Error("จำนวนขั้นต่ำของกลุ่ม Modifier มากกว่าตัวเลือกที่เปิดใช้");
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
  const saved = (await listProductModifiers(tenantId, productSku, size))
    .find((modifier) => modifier.id === modifierId);
  if (!saved) throw new Error("ไม่พบ Modifier หลังบันทึก");
  return saved;
}
