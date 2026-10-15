// Planning estimates only. Never import this calculator into settlement, stock or profit reports.
export type RecipeCostRate = { quantity: number; rate: number; source: string };
export type RecipeCostAssumptions = {
  labor: RecipeCostRate | null;
  electricity: RecipeCostRate | null;
  gas: RecipeCostRate | null;
};
const CATEGORIES = ["labor", "electricity", "gas"] as const;
const SCALE = 1_000_000n;
const DENOMINATOR = SCALE * SCALE * 60n;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid recipe cost assumptions");
  return value as Record<string, unknown>;
}

function decimal(value: unknown, maximum: number): bigint | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const text = String(value);
  if (!/^\d+(?:\.\d{1,6})?$/.test(text) || Number(text) > maximum) return null;
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
}

/** Omission preserves existing assumptions in the caller; explicit null clears all three. */
export function normalizeRecipeCostAssumptions(value: unknown): RecipeCostAssumptions {
  const raw = value == null ? {} : record(value);
  if (Object.keys(raw).some(key => !CATEGORIES.includes(key as typeof CATEGORIES[number]))) {
    throw new Error("Unknown recipe cost assumption");
  }
  const result: RecipeCostAssumptions = { labor: null, electricity: null, gas: null };
  for (const category of CATEGORIES) {
    if (raw[category] == null) continue;
    const line = record(raw[category]);
    if (Object.keys(line).some(key => !["quantity", "rate", "source"].includes(key))
      || typeof line.quantity !== "number" || decimal(line.quantity, 1_000_000) == null
      || typeof line.rate !== "number" || decimal(line.rate, 1_000_000) == null
      || typeof line.source !== "string" || !line.source.trim() || line.source.trim().length > 500) {
      throw new Error("Cost estimates require quantity/rate (0–1,000,000, at most 6 decimals) and a source (1–500 characters)");
    }
    result[category] = { quantity: line.quantity, rate: line.rate, source: line.source.trim() };
  }
  return result;
}

function money(numerator: bigint, outputQty = 1): number {
  const divisor = DENOMINATOR * BigInt(outputQty);
  const cents = (numerator * 100n + divisor / 2n) / divisor;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Recipe cost estimate exceeds safe money range");
  return Number(cents) / 100;
}

export function calculateRecipeCostEstimate(input: {
  outputQty: number;
  assumptions: unknown;
  ingredients: Array<{ sku: string; size: string; qty: number; unitCost: unknown }>;
}) {
  if (!Number.isInteger(input.outputQty) || input.outputQty < 1 || input.outputQty > 2_147_483_647
    || !input.ingredients.length || input.ingredients.length > 200) throw new Error("Invalid recipe cost definition");
  const assumptions = normalizeRecipeCostAssumptions(input.assumptions);
  let ingredientNumerator = 0n;
  let missingIngredientCount = 0;
  const ingredients = input.ingredients.map(item => {
    if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > 2_147_483_647) throw new Error("Invalid ingredient quantity");
    const cost = decimal(item.unitCost, 9_999_999_999.99);
    const amount = cost == null ? null : cost * BigInt(item.qty) * SCALE * 60n;
    if (amount == null) missingIngredientCount++; else ingredientNumerator += amount;
    return { sku: item.sku, size: item.size, qty: item.qty,
      unitCost: cost == null ? null : Number(cost) / Number(SCALE),
      batchCost: amount == null ? null : money(amount),
      source: cost != null ? "CATALOG_CURRENT" : item.unitCost == null ? "MISSING" : "INVALID_CATALOG" };
  });
  const overhead = CATEGORIES.map(category => {
    const assumption = assumptions[category];
    // labor = person-minutes * THB/person-hour / 60; electricity = kWh; gas = kg.
    const numerator = assumption == null ? null
      : decimal(assumption.quantity, 1_000_000)! * decimal(assumption.rate, 1_000_000)! * (category === "labor" ? 1n : 60n);
    return { category, assumption, numerator };
  });
  const known = ingredientNumerator + overhead.reduce((sum, row) => sum + (row.numerator ?? 0n), 0n);
  const complete = missingIngredientCount === 0 && overhead.every(row => row.numerator != null);
  return {
    status: complete ? "COMPLETE" : "INCOMPLETE", currency: "THB", scope: "WHOLE_BATCH_INCLUDING_SUBRECIPES",
    outputQty: input.outputQty, missingIngredientCount, ingredients,
    ingredientBatchCost: missingIngredientCount ? null : money(ingredientNumerator),
    knownBatchCost: money(known), totalBatchCost: complete ? money(known) : null,
    totalUnitCost: complete ? money(known, input.outputQty) : null,
    overhead: overhead.map(({ category, assumption, numerator }) => ({ category,
      quantity: assumption?.quantity ?? null, rate: assumption?.rate ?? null, source: assumption?.source ?? null,
      batchCost: numerator == null ? null : money(numerator) })),
  };
}
