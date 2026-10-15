/** Recipe quantities are PostgreSQL INTEGER base units, not rounded display quantities. */
export type RecipeComponentInput = { sku: string; size: string; qty: number };
export type RecipeDefinition = { outputQty: number; items: RecipeComponentInput[] };

export function positiveBaseQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
}

export function normalizeRecipeDefinition(input: RecipeDefinition): RecipeDefinition {
  if (!positiveBaseQuantity(input.outputQty)) throw new Error("จำนวนผลผลิตต้องเป็นจำนวนเต็มบวกของหน่วยฐาน");
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("สูตรต้องมีวัตถุดิบอย่างน้อย 1 รายการ");
  }
  const keys = new Set<string>();
  const items = input.items.map((item) => {
    const sku = typeof item?.sku === "string" ? item.sku.trim() : "";
    const size = typeof item?.size === "string" ? item.size.trim() : "";
    if (!sku || !size || !positiveBaseQuantity(item?.qty)) {
      throw new Error("วัตถุดิบและจำนวนหน่วยฐานไม่ถูกต้อง ต้องใช้จำนวนเต็มบวก");
    }
    const key = JSON.stringify([sku, size]);
    if (keys.has(key)) throw new Error(`วัตถุดิบซ้ำในสูตร: ${sku} (${size})`);
    keys.add(key);
    return { sku, size, qty: item.qty };
  });
  return { outputQty: input.outputQty, items };
}

/** Row order is presentation only; reordering a recipe must not manufacture a new version. */
export function sameRecipeDefinition(a: RecipeDefinition, b: RecipeDefinition): boolean {
  const canonical = (items: RecipeComponentInput[]) => items
    .map(({ sku, size, qty }) => JSON.stringify([sku, size, qty])).sort();
  return a.outputQty === b.outputQty
    && JSON.stringify(canonical(a.items)) === JSON.stringify(canonical(b.items));
}
