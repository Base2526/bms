export const PRODUCT_SALES_SURFACES = [
  "RETAIL_POS",
  "RESTAURANT_POS",
  "PUBLIC_STOREFRONT",
  "CUSTOMER_AI",
  "ONLINE_ORDER",
] as const;

export type ProductSalesSurface = typeof PRODUCT_SALES_SURFACES[number];

export const PRODUCT_CREATION_TEMPLATES = [
  "QUICK_MENU",
  "PREPARED_MENU",
  "READY_GOOD",
  "INGREDIENT",
  "GENERAL",
] as const;

export type ProductCreationTemplate = typeof PRODUCT_CREATION_TEMPLATES[number];

export type ProductTemplateDefaults = {
  stockPolicy: "DIRECT" | "RECIPE" | "NON_STOCK";
  baseUnit: string;
  surfaces: ProductSalesSurface[];
  active: false;
};

/**
 * Pure, shared defaults for product creation. Keep this module free of database and
 * server-only imports so both the admin client and backend validation use one source.
 */
export function productTemplateDefaults(template: string | null | undefined): ProductTemplateDefaults {
  switch (String(template ?? "").trim().toUpperCase()) {
    case "QUICK_MENU":
      return {
        stockPolicy: "NON_STOCK",
        baseUnit: "PIECE",
        surfaces: ["RESTAURANT_POS", "CUSTOMER_AI", "ONLINE_ORDER"],
        active: false,
      };
    case "PREPARED_MENU":
      return { stockPolicy: "RECIPE", baseUnit: "PIECE", surfaces: ["RESTAURANT_POS"], active: false };
    case "READY_GOOD":
      return { stockPolicy: "DIRECT", baseUnit: "PIECE", surfaces: ["RESTAURANT_POS", "RETAIL_POS"], active: false };
    case "INGREDIENT":
      return { stockPolicy: "DIRECT", baseUnit: "PIECE", surfaces: [], active: false };
    default:
      return {
        stockPolicy: "DIRECT",
        baseUnit: "PIECE",
        surfaces: ["RETAIL_POS", "PUBLIC_STOREFRONT", "CUSTOMER_AI", "ONLINE_ORDER"],
        active: false,
      };
  }
}

/**
 * Creation templates are presets, not persistent product types. Reconstruct the closest
 * presentation template when editing so restaurant ingredients and quick menus do not fall
 * back to a retail-looking form merely because they share a stock policy with other products.
 */
export function inferProductCreationTemplate(
  stockPolicy: string | null | undefined,
  salesSurfaces: readonly string[] | null | undefined
): ProductCreationTemplate {
  const policy = String(stockPolicy ?? "").trim().toUpperCase();
  const surfaces = new Set(salesSurfaces ?? []);
  if (policy === "RECIPE") return "PREPARED_MENU";
  if (policy === "NON_STOCK") return "QUICK_MENU";
  if (policy === "DIRECT" && surfaces.size === 0) return "INGREDIENT";
  if (policy === "DIRECT" && surfaces.has("RESTAURANT_POS")) return "READY_GOOD";
  return "GENERAL";
}
