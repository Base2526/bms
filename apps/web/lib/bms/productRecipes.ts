import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { assertReadinessAllowsSaveOfActiveProduct, getProductReadinessInTx } from "./productConfiguration";
import { positiveBaseQuantity, sameRecipeDefinition, type RecipeComponentInput } from "./recipeDefinition";
import { normalizeRecipeCostAssumptions, type RecipeCostAssumptions } from "./recipeCosting";
import { flattenRecipeComposition, loadPinnedRecipeCompositionInTx, normalizeDirectRecipeItems,
  normalizeRecipeReferences, normalizeRecipeSteps, sameRecipeReferences,
  type RecipeReference, type RecipeReferenceInput } from "./recipeComposition";

export type { RecipeComponentInput } from "./recipeDefinition";
export type ProductRecipe = {
  id: string;
  productSku: string;
  size: string;
  version: number;
  outputQty: number;
  active: boolean;
  items: RecipeComponentInput[];
  directItems: RecipeComponentInput[];
  subrecipes: RecipeReference[];
  sopSteps: string[];
  costAssumptions: RecipeCostAssumptions;
};

type RecipeHeaderRow = {
  product_sku: string;
  size: string;
  output_qty: number;
  active: boolean;
  version: number;
  direct_items?: RecipeComponentInput[] | null;
  sop_steps?: string[];
  cost_assumptions?: RecipeCostAssumptions | null;
  subrecipes?: RecipeReference[];
};

const recipeReferencesSql = `COALESCE((SELECT jsonb_agg(jsonb_build_object(
  'recipeId', s.child_recipe_id, 'qty', s.qty, 'productSku', child.product_sku,
  'size', child.size, 'version', child.version, 'outputQty', child.output_qty) ORDER BY s.child_recipe_id)
  FROM bms_product_recipe_subrecipes s JOIN bms_product_recipes child
    ON child.tenant_id=s.tenant_id AND child.id=s.child_recipe_id
  WHERE s.tenant_id=r.tenant_id AND s.recipe_id=r.id), '[]'::jsonb)`;

export async function listProductRecipes(
  tenantId: string,
  productSku: string,
  size?: string | null
): Promise<ProductRecipe[]> {
  const result = await query<any>(
    `SELECT r.id, r.product_sku, r.size, r.version, r.output_qty, r.active, r.direct_items, r.sop_steps, r.cost_assumptions,
            ${recipeReferencesSql} AS subrecipes,
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
    directItems: normalizeDirectRecipeItems(row.direct_items ?? row.items ?? []),
    subrecipes: row.subrecipes ?? [],
    sopSteps: normalizeRecipeSteps(row.sop_steps ?? []),
    costAssumptions: normalizeRecipeCostAssumptions(row.cost_assumptions),
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
    /** Legacy flat editor input. Composed recipes must use directItems when changing ingredients. */
    items?: RecipeComponentInput[];
    directItems?: RecipeComponentInput[];
    subrecipes?: RecipeReferenceInput[];
    sopSteps?: string[];
    costAssumptions?: RecipeCostAssumptions | null;
  },
  editorId?: string | null
): Promise<ProductRecipe> {
  const productSku = String(input.productSku ?? "").trim();
  const size = String(input.size ?? "").trim();
  if (input.items !== undefined && input.directItems !== undefined) throw new Error("ส่ง items หรือ directItems ได้เพียงแบบเดียว");
  const suppliedItems = input.directItems !== undefined ? normalizeDirectRecipeItems(input.directItems)
    : input.items !== undefined ? normalizeDirectRecipeItems(input.items) : undefined;
  const suppliedReferences = input.subrecipes === undefined ? undefined : normalizeRecipeReferences(input.subrecipes);
  const suppliedSteps = input.sopSteps === undefined ? undefined : normalizeRecipeSteps(input.sopSteps);
  const suppliedCosts = input.costAssumptions === undefined ? undefined : normalizeRecipeCostAssumptions(input.costAssumptions);
  if (input.outputQty != null && !positiveBaseQuantity(input.outputQty)) throw new Error("จำนวนผลผลิตต้องเป็นจำนวนเต็มบวกของหน่วยฐาน");
  if (!productSku || !size) throw new Error("ต้องระบุสินค้าและตัวเลือกของเมนู");
  if (input.active != null && typeof input.active !== "boolean") throw new Error("สถานะสูตรไม่ถูกต้อง");
  if (suppliedItems?.some((item) => item.sku === productSku)) throw new Error("เมนูเป็นวัตถุดิบของตัวเองไม่ได้");

  const client = await getClient();
  let recipeId = input.id ?? null;
  try {
    await beginTenantTx(client, tenantId, editorId ? { editorId } : undefined);
    const owned = await client.query<{ active: boolean }>(
      `SELECT active FROM bms_products WHERE tenant_id = $1 AND sku = $2 FOR UPDATE`,
      [tenantId, productSku]
    );
    if (!owned.rowCount) throw new Error("ไม่พบเมนูนี้ในร้าน");
    let existing: RecipeHeaderRow | null = null;
    let contentChanged = false;
    let oldItems: RecipeComponentInput[] = [];
    if (recipeId) {
      const locked = await client.query<RecipeHeaderRow>(
        `SELECT r.product_sku, r.size, r.output_qty, r.active, r.version, r.direct_items, r.sop_steps, r.cost_assumptions,
                ${recipeReferencesSql} AS subrecipes FROM bms_product_recipes r
          WHERE r.tenant_id = $1 AND r.id = $2 FOR NO KEY UPDATE OF r`,
        [tenantId, recipeId]
      );
      existing = locked.rows[0] ?? null;
      if (!existing) throw new Error("ไม่พบสูตรนี้ในร้าน");
      if (existing.product_sku !== productSku || existing.size !== size) {
        throw new Error("ย้ายสูตรไปสินค้า/ตัวเลือกอื่นไม่ได้ ให้สร้าง version ใหม่");
      }
      const components = await client.query<{ component_sku: string; component_size: string; qty: number }>(
        `SELECT component_sku, component_size, qty FROM bms_product_recipe_items
          WHERE tenant_id = $1 AND recipe_id = $2 ORDER BY component_sku, component_size`,
        [tenantId, recipeId]
      );
      oldItems = components.rows.map(row => ({ sku: row.component_sku, size: row.component_size, qty: Number(row.qty) }));
    }

    const oldReferences = existing?.subrecipes ?? [];
    const oldDirect = normalizeDirectRecipeItems(existing?.direct_items ?? oldItems);
    let directItems = suppliedItems ?? oldDirect;
    if (input.items !== undefined && oldReferences.length) {
      // Old clients read the flattened BOM. Never add pinned children to it a second time or
      // silently erase their provenance when a legacy editor saves/activates a composed recipe.
      if (!sameRecipeDefinition({ outputQty: 1, items: suppliedItems! }, { outputQty: 1, items: oldItems })) {
        throw new Error("สูตรนี้มีสูตรย่อย กรุณาใช้ตัวแก้ไข directItems และ subrecipes");
      }
      directItems = oldDirect;
    }
    const references = suppliedReferences ?? normalizeRecipeReferences(oldReferences);
    const sopSteps = suppliedSteps ?? normalizeRecipeSteps(existing?.sop_steps ?? []);
    const oldCosts = normalizeRecipeCostAssumptions(existing?.cost_assumptions);
    const costAssumptions = suppliedCosts ?? oldCosts;
    const outputQty = input.outputQty ?? Number(existing?.output_qty ?? 1);
    const children = await loadPinnedRecipeCompositionInTx(client, tenantId, productSku, references);
    const items = flattenRecipeComposition(productSku, directItems, children);
    const subrecipes = children.map(({ items: _items, ...ref }) => ref);
    if (existing) contentChanged = !sameRecipeDefinition({ outputQty, items: directItems }, {
      outputQty: Number(existing.output_qty), items: oldDirect,
    }) || !sameRecipeReferences(references, oldReferences)
      || JSON.stringify(sopSteps) !== JSON.stringify(existing.sop_steps ?? [])
      || JSON.stringify(costAssumptions) !== JSON.stringify(oldCosts);

    // Recipe content is append-only through this service, even when the old version is inactive.
    // Keep the old API shape: an id is the source version, and the returned id is authoritative.
    const sourceRecipeId = contentChanged ? recipeId : null;
    if (contentChanged) recipeId = null;
    const active = input.active ?? existing?.active ?? false;
    if (active) {
      await client.query(
        `UPDATE bms_product_recipes SET active = FALSE, updated_at = now()
          WHERE tenant_id = $1 AND product_sku = $2 AND size = $3
            AND ($4::uuid IS NULL OR id <> $4) AND active`,
        [tenantId, productSku, size, recipeId]
      );
    }
    let version = Number(existing?.version ?? 0);
    if (!recipeId) {
      // The product row above serializes version allocation and activation for this SKU.
      const recipe = await client.query<{ id: string; version: number }>(
        `INSERT INTO bms_product_recipes
           (tenant_id, product_sku, size, version, output_qty, active, direct_items, sop_steps, cost_assumptions)
         VALUES ($1, $2, $3,
           COALESCE((SELECT max(version) + 1 FROM bms_product_recipes
                      WHERE tenant_id = $1 AND product_sku = $2 AND size = $3), 1), $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
         RETURNING id, version`,
        [tenantId, productSku, size, outputQty, active, JSON.stringify(directItems), JSON.stringify(sopSteps), JSON.stringify(costAssumptions)]
      );
      recipeId = recipe.rows[0].id;
      version = Number(recipe.rows[0].version);
      for (const item of items) {
        await client.query(
          `INSERT INTO bms_product_recipe_items
             (tenant_id, recipe_id, component_sku, component_size, qty)
           VALUES ($1,$2,$3,$4,$5)`,
          [tenantId, recipeId, item.sku, item.size, item.qty]
        );
      }
      for (const ref of references) {
        await client.query(`INSERT INTO bms_product_recipe_subrecipes (tenant_id, recipe_id, child_recipe_id, qty)
          VALUES ($1,$2,$3,$4)`, [tenantId, recipeId, ref.recipeId, ref.qty]);
      }
    } else if (active !== existing?.active) {
      await client.query(
        `UPDATE bms_product_recipes SET active = $3, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, recipeId, active]
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
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,'product.recipe_upsert',$3,$4)`,
      [tenantId, editorId ?? null, recipeId, JSON.stringify({ sku: productSku, size, version, active, sourceRecipeId,
        subrecipeCount: references.length, sopStepCount: sopSteps.length,
        costAssumptionCount: Object.values(costAssumptions).filter(Boolean).length })]
    );
    const saved: ProductRecipe = { id: recipeId, productSku, size, version, outputQty, active, items, directItems, subrecipes, sopSteps, costAssumptions };
    await client.query("COMMIT");
    return saved;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
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
  const groupName = String(input.groupName ?? "ตัวเลือก").trim();
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
