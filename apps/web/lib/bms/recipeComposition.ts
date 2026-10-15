import type { PoolClient } from "pg";
import { normalizeRecipeDefinition, type RecipeComponentInput } from "./recipeDefinition";

export type RecipeReferenceInput = { recipeId: string; qty: number };
export type RecipeReference = RecipeReferenceInput & { productSku: string; size: string; version: number; outputQty: number };
export const RECIPE_LIMITS = { items: 200, references: 20, nodes: 64, depth: 8, steps: 50, stepLength: 2000 } as const;
const maxQuantity = 2147483647;
const integer = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= maxQuantity;

export function normalizeRecipeReferences(value: unknown): RecipeReferenceInput[] {
  if (!Array.isArray(value) || value.length > RECIPE_LIMITS.references) throw new Error("สูตรย่อยต้องไม่เกิน 20 รายการ");
  const seen = new Set<string>();
  return value.map(ref => {
    const recipeId = typeof ref?.recipeId === "string" ? ref.recipeId.trim().toLowerCase() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(recipeId) || !integer(ref?.qty)) {
      throw new Error("ต้องเลือก version สูตรย่อยและจำนวนผลผลิตเป็นจำนวนเต็มบวก");
    }
    if (seen.has(recipeId)) throw new Error("สูตรย่อย version เดียวกันซ้ำในสูตร");
    seen.add(recipeId);
    return { recipeId, qty: ref.qty };
  });
}

export function normalizeRecipeSteps(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > RECIPE_LIMITS.steps) throw new Error("SOP ต้องไม่เกิน 50 ขั้นตอน");
  return value.map(step => {
    if (typeof step !== "string" || !step.trim() || step.trim().length > RECIPE_LIMITS.stepLength) {
      throw new Error("แต่ละขั้นตอน SOP ต้องมีข้อความไม่เกิน 2,000 ตัวอักษร");
    }
    return step.trim();
  });
}

export function normalizeDirectRecipeItems(value: unknown): RecipeComponentInput[] {
  if (!Array.isArray(value) || value.length > RECIPE_LIMITS.items) throw new Error("วัตถุดิบต้องไม่เกิน 200 รายการ");
  return value.length ? normalizeRecipeDefinition({ outputQty: 1, items: value }).items : [];
}

export function sameRecipeReferences(a: RecipeReferenceInput[], b: RecipeReferenceInput[]): boolean {
  const key = (refs: RecipeReferenceInput[]) => refs.map(r => JSON.stringify([r.recipeId, r.qty])).sort();
  return JSON.stringify(key(a)) === JSON.stringify(key(b));
}

/** Compile once at save time. All existing stock/availability/cost readers keep the same leaf BOM. */
export function flattenRecipeComposition(productSku: string, direct: RecipeComponentInput[],
  children: Array<RecipeReference & { items: RecipeComponentInput[] }>): RecipeComponentInput[] {
  const totals = new Map<string, RecipeComponentInput>();
  const add = (item: RecipeComponentInput) => {
    if (item.sku === productSku) throw new Error("สูตรอ้างกลับมาที่สินค้าแม่ไม่ได้");
    const key = JSON.stringify([item.sku, item.size]);
    const qty = (totals.get(key)?.qty ?? 0) + item.qty;
    if (!integer(qty)) throw new Error("จำนวนวัตถุดิบรวมเกินขอบเขตหน่วยฐาน");
    totals.set(key, { ...item, qty });
  };
  for (const item of normalizeDirectRecipeItems(direct)) add(item);
  for (const child of children) {
    if (child.productSku === productSku || !integer(child.qty) || !integer(child.outputQty)) throw new Error("สูตรย่อยไม่ถูกต้องหรืออ้างกลับมาที่สินค้าแม่");
    const definition = normalizeRecipeDefinition({ outputQty: child.outputQty, items: child.items });
    for (const item of definition.items) {
      const numerator = BigInt(item.qty) * BigInt(child.qty);
      if (numerator % BigInt(child.outputQty) !== BigInt(0)) {
        throw new Error(`สูตรย่อยให้วัตถุดิบ ${item.sku} (${item.size}) เป็นเศษหน่วยฐาน กรุณาปรับหน่วยหรือจำนวนผลผลิต`);
      }
      const qty = numerator / BigInt(child.outputQty);
      if (qty > BigInt(maxQuantity)) throw new Error("จำนวนวัตถุดิบรวมเกินขอบเขตหน่วยฐาน");
      add({ ...item, qty: Number(qty) });
    }
  }
  if (!totals.size || totals.size > RECIPE_LIMITS.items) throw new Error("สูตรต้องมีวัตถุดิบรวม 1–200 รายการ");
  return [...totals.values()].sort((a, b) => a.sku.localeCompare(b.sku) || a.size.localeCompare(b.size));
}

/** Pinned versions may be inactive. Never resolve the current active recipe during composition. */
export async function loadPinnedRecipeCompositionInTx(client: PoolClient, tenantId: string,
  productSku: string, references: RecipeReferenceInput[]) {
  type Node = { id: string; product_sku: string; size: string; version: number; output_qty: number;
    items: RecipeComponentInput[]; children: RecipeReferenceInput[] };
  const cache = new Map<string, Node>();
  let visits = 0;
  async function visit(id: string, path: string[], depth: number): Promise<Node> {
    if (++visits > 256) throw new Error("สายสูตรย่อยซับซ้อนเกินขอบเขตที่รองรับ");
    if (depth > RECIPE_LIMITS.depth) throw new Error("สูตรย่อยซ้อนกันได้ไม่เกิน 8 ระดับ");
    let node = cache.get(id);
    if (!node) {
      if (cache.size >= RECIPE_LIMITS.nodes) throw new Error("สูตรย่อยเชื่อมโยงเกิน 64 versions");
      const result = await client.query<Node>(
        `SELECT r.id, r.product_sku, r.size, r.version, r.output_qty,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('sku',i.component_sku,'size',i.component_size,'qty',i.qty))
            FROM bms_product_recipe_items i WHERE i.tenant_id=r.tenant_id AND i.recipe_id=r.id), '[]'::jsonb) AS items,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('recipeId',s.child_recipe_id,'qty',s.qty))
            FROM bms_product_recipe_subrecipes s WHERE s.tenant_id=r.tenant_id AND s.recipe_id=r.id), '[]'::jsonb) AS children
         FROM bms_product_recipes r WHERE r.tenant_id=$1 AND r.id=$2 FOR KEY SHARE OF r`, [tenantId, id]);
      node = result.rows[0];
      if (!node) throw new Error("ไม่พบ version สูตรย่อยในร้านนี้");
      normalizeRecipeDefinition({ outputQty: Number(node.output_qty), items: node.items });
      node.children = normalizeRecipeReferences(node.children);
      cache.set(id, node);
    }
    if (path.includes(node.product_sku)) throw new Error("สูตรย่อยอ้างวนกลับมาที่สินค้าในสายสูตรเดิมไม่ได้");
    for (const child of node.children) await visit(child.recipeId, [...path, node.product_sku], depth + 1);
    return node;
  }
  const children: Array<RecipeReference & { items: RecipeComponentInput[] }> = [];
  for (const ref of normalizeRecipeReferences(references)) {
    const node = await visit(ref.recipeId, [productSku], 1);
    children.push({ ...ref, productSku: node.product_sku, size: node.size, version: Number(node.version),
      outputQty: Number(node.output_qty), items: node.items });
  }
  return children;
}
