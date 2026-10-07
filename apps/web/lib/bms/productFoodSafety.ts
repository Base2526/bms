/**
 * Structured, shop-maintained food declarations used by product forms and customer-safe tools.
 * Missing codes are never proof that an allergen is absent; dietary tags are not certifications.
 */
export const FOOD_ALLERGEN_CODES = [
  "PEANUT", "TREE_NUT", "MILK", "EGG", "WHEAT_GLUTEN", "SOY",
  "FISH", "SHELLFISH", "SESAME", "SULPHITE",
] as const;

export type FoodAllergenCode = (typeof FOOD_ALLERGEN_CODES)[number];

export const DIETARY_TAGS = ["VEGETARIAN", "VEGAN", "JAY", "HALAL"] as const;
export type DietaryTag = (typeof DIETARY_TAGS)[number];

function normalizedEnumArray<T extends string>(input: unknown, allowed: readonly T[], field: string): T[] | null {
  if (input === undefined) return null;
  if (!Array.isArray(input)) throw new Error(`${field} ต้องเป็นรายการ`);
  const allow = new Set<string>(allowed);
  const result = Array.from(new Set(input.map((value) => String(value).trim().toUpperCase()).filter(Boolean)));
  const invalid = result.find((value) => !allow.has(value));
  if (invalid) throw new Error(`${field} มีค่าที่ไม่รองรับ: ${invalid}`);
  return result as T[];
}

export function normalizeFoodAllergenCodes(input: unknown): FoodAllergenCode[] | null {
  return normalizedEnumArray(input, FOOD_ALLERGEN_CODES, "สารก่อภูมิแพ้");
}

export function normalizeDietaryTags(input: unknown): DietaryTag[] | null {
  return normalizedEnumArray(input, DIETARY_TAGS, "ป้ายอาหาร");
}

export function customerFoodProfile(input: {
  allergenCodes?: readonly string[] | null;
  allergenInformationProvided?: boolean | null;
  dietaryTags?: readonly string[] | null;
  foodSafetyNote?: string | null;
}) {
  const provided = input.allergenInformationProvided === true;
  return {
    allergenInformationProvided: provided,
    declaredAllergens: provided ? [...(input.allergenCodes ?? [])] : [],
    dietaryTags: [...(input.dietaryTags ?? [])],
    note: input.foodSafetyNote?.trim().slice(0, 500) || null,
    crossContactUnknown: true,
  };
}
