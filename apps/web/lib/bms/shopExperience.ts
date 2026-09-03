import { normalizeShopArchetype, type ShopArchetype } from "./shopArchetypes";
import {
  PRODUCT_CREATION_TEMPLATES,
  type ProductCreationTemplate,
  type ProductSalesSurface,
} from "./productTemplatePresets";

export type ShopExperienceCapability =
  | "PACK" | "MULTI_BARCODE" | "LOT_TRACKING" | "EXPIRY_TRACKING" | "FEFO"
  | "WEIGHTED_PRODUCT" | "UNIT_CONVERSION" | "SERIAL_TRACKING" | "PHARMACY_POLICY"
  | "RECIPE" | "MODIFIER" | "KITCHEN_WORKFLOW" | "WASTAGE";

export type StockExperienceSection =
  | "LOT_EXPIRY" | "KITCHEN_STATION" | "SCALE" | "STATION_SLA" | "RECIPES" | "MODIFIERS" | "BUNDLE";

export type ShopExperienceProfile = {
  archetype: ShopArchetype;
  recommendedTemplates: readonly ProductCreationTemplate[];
  recommendedCapabilities: readonly ShopExperienceCapability[];
  primarySalesSurfaces: readonly ProductSalesSurface[];
  recommendedStockSections: readonly StockExperienceSection[];
  restockEmphasis: boolean;
  showWastageInNavigation: boolean;
  specialMode: "NONE" | "PHARMACY" | "RESTAURANT";
  descriptionKey: string;
  importExample: readonly string[];
};

export type ProductFormFieldVisibility = {
  barcode: boolean;
  shippingWeight: boolean;
  brand: boolean;
  wholesalePriceTiers: boolean;
};

const RETAIL_SURFACES = ["RETAIL_POS", "PUBLIC_STOREFRONT", "CUSTOMER_AI", "ONLINE_ORDER"] as const;
const GENERAL_TEMPLATE = ["GENERAL"] as const;

const EXPERIENCES: Record<ShopArchetype, ShopExperienceProfile> = {
  mini_mart: {
    archetype: "mini_mart",
    recommendedTemplates: GENERAL_TEMPLATE,
    recommendedCapabilities: ["PACK", "MULTI_BARCODE", "LOT_TRACKING", "EXPIRY_TRACKING", "WEIGHTED_PRODUCT"],
    primarySalesSurfaces: RETAIL_SURFACES,
    recommendedStockSections: ["LOT_EXPIRY", "SCALE"],
    restockEmphasis: true,
    showWastageInNavigation: false,
    specialMode: "NONE",
    descriptionKey: "shop_archetypes.description_mini_mart",
    importExample: ["MM-WATER-600", "", "น้ำดื่ม 600 มล.", "สินค้าขายเป็นชิ้น", "10", "6", "เครื่องดื่ม", "", "น้ำดื่ม|600ml", "GENERAL", "DIRECT", "PIECE", "STD", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
  },
  fashion: {
    archetype: "fashion",
    recommendedTemplates: GENERAL_TEMPLATE,
    recommendedCapabilities: ["PACK", "MULTI_BARCODE"],
    primarySalesSurfaces: RETAIL_SURFACES,
    recommendedStockSections: [],
    restockEmphasis: true,
    showWastageInNavigation: false,
    specialMode: "NONE",
    descriptionKey: "shop_archetypes.description_fashion",
    importExample: ["FASHION-TEE-01", "", "เสื้อยืด Cotton Relaxed", "เสื้อยืดมีหลายไซซ์", "490", "220", "เสื้อผ้า", "", "เสื้อยืด|cotton", "GENERAL", "DIRECT", "PIECE", "S|M|L|XL", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
  },
  home_kitchen: {
    archetype: "home_kitchen",
    recommendedTemplates: GENERAL_TEMPLATE,
    recommendedCapabilities: ["PACK", "MULTI_BARCODE", "SERIAL_TRACKING"],
    primarySalesSurfaces: RETAIL_SURFACES,
    recommendedStockSections: [],
    restockEmphasis: true,
    showWastageInNavigation: false,
    specialMode: "NONE",
    descriptionKey: "shop_archetypes.description_home_kitchen",
    importExample: ["HOME-PAN-24", "", "กระทะสเตนเลส 24 ซม.", "กระทะพร้อมฝาปิด", "890", "520", "เครื่องครัว", "", "กระทะ|24ซม", "GENERAL", "DIRECT", "PIECE", "24CM", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
  },
  beauty_personal_care: {
    archetype: "beauty_personal_care",
    recommendedTemplates: GENERAL_TEMPLATE,
    recommendedCapabilities: ["PACK", "MULTI_BARCODE", "LOT_TRACKING", "EXPIRY_TRACKING"],
    primarySalesSurfaces: RETAIL_SURFACES,
    recommendedStockSections: ["LOT_EXPIRY"],
    restockEmphasis: true,
    showWastageInNavigation: false,
    specialMode: "NONE",
    descriptionKey: "shop_archetypes.description_beauty_personal_care",
    importExample: ["BEAUTY-SERUM-30", "", "เซรั่มบำรุงผิว 30 มล.", "เซรั่มสำหรับใช้ประจำวัน", "590", "280", "สกินแคร์", "", "เซรั่ม|30ml", "GENERAL", "DIRECT", "PIECE", "30ML", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
  },
  food_beverage: {
    archetype: "food_beverage",
    recommendedTemplates: GENERAL_TEMPLATE,
    recommendedCapabilities: ["PACK", "LOT_TRACKING", "EXPIRY_TRACKING", "RECIPE", "MODIFIER", "WASTAGE"],
    primarySalesSurfaces: RETAIL_SURFACES,
    recommendedStockSections: ["LOT_EXPIRY", "RECIPES", "MODIFIERS"],
    restockEmphasis: false,
    showWastageInNavigation: true,
    specialMode: "NONE",
    descriptionKey: "shop_archetypes.description_food_beverage",
    importExample: ["FOOD-COOKIE-01", "", "คุกกี้ช็อกโกแลต", "ขนมพร้อมขาย", "65", "28", "เบเกอรี่", "", "คุกกี้|ช็อกโกแลต", "GENERAL", "DIRECT", "PIECE", "STD", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
  },
  gadgets_accessories: {
    archetype: "gadgets_accessories",
    recommendedTemplates: GENERAL_TEMPLATE,
    recommendedCapabilities: ["PACK", "MULTI_BARCODE", "SERIAL_TRACKING"],
    primarySalesSurfaces: RETAIL_SURFACES,
    recommendedStockSections: [],
    restockEmphasis: true,
    showWastageInNavigation: false,
    specialMode: "NONE",
    descriptionKey: "shop_archetypes.description_gadgets_accessories",
    importExample: ["GADGET-CASE-IP15", "", "เคสสำหรับ iPhone 15", "เคสกันกระแทก", "390", "150", "เคส", "", "เคส|iphone 15", "GENERAL", "DIRECT", "PIECE", "BLACK|CLEAR", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
  },
  b2b_wholesale: {
    archetype: "b2b_wholesale",
    recommendedTemplates: GENERAL_TEMPLATE,
    recommendedCapabilities: ["PACK", "MULTI_BARCODE", "UNIT_CONVERSION"],
    primarySalesSurfaces: RETAIL_SURFACES,
    recommendedStockSections: [],
    restockEmphasis: false,
    showWastageInNavigation: false,
    specialMode: "NONE",
    descriptionKey: "shop_archetypes.description_b2b_wholesale",
    importExample: ["B2B-PAPER-A4", "", "กระดาษ A4", "ขายเป็นรีมและลัง", "125", "92", "อุปกรณ์สำนักงาน", "", "กระดาษ|a4|รีม", "GENERAL", "DIRECT", "PIECE", "REAM", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
  },
  gifts_seasonal: {
    archetype: "gifts_seasonal",
    recommendedTemplates: GENERAL_TEMPLATE,
    recommendedCapabilities: ["PACK", "MULTI_BARCODE"],
    primarySalesSurfaces: RETAIL_SURFACES,
    // กระเช้า/ชุดของขวัญคือสินค้าชุด — ส่วนประกอบต้องอยู่ในสายตาตั้งแต่แรก
    recommendedStockSections: ["BUNDLE"],
    restockEmphasis: false,
    showWastageInNavigation: false,
    specialMode: "NONE",
    descriptionKey: "shop_archetypes.description_gifts_seasonal",
    importExample: ["GIFT-SET-01", "", "ชุดของขวัญ Everyday", "ชุดของขวัญพร้อมขาย", "790", "390", "Gift Set", "", "ของขวัญ|gift set", "GENERAL", "DIRECT", "PIECE", "STD", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
  },
  pharmacy: {
    archetype: "pharmacy",
    recommendedTemplates: GENERAL_TEMPLATE,
    recommendedCapabilities: ["PACK", "MULTI_BARCODE", "LOT_TRACKING", "EXPIRY_TRACKING", "FEFO", "PHARMACY_POLICY"],
    primarySalesSurfaces: RETAIL_SURFACES,
    recommendedStockSections: ["LOT_EXPIRY"],
    restockEmphasis: false,
    showWastageInNavigation: false,
    specialMode: "PHARMACY",
    descriptionKey: "shop_archetypes.description_pharmacy",
    importExample: ["PHARMACY-ITEM-01", "", "สินค้าสุขภาพตัวอย่าง", "ต้องตั้งนโยบายก่อนเปิดขาย", "120", "70", "สินค้าสุขภาพ", "", "สุขภาพ", "GENERAL", "DIRECT", "PIECE", "STD", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
  },
  pet_supply: {
    archetype: "pet_supply",
    recommendedTemplates: GENERAL_TEMPLATE,
    recommendedCapabilities: ["PACK", "MULTI_BARCODE", "LOT_TRACKING", "EXPIRY_TRACKING", "WEIGHTED_PRODUCT"],
    primarySalesSurfaces: RETAIL_SURFACES,
    recommendedStockSections: ["LOT_EXPIRY", "SCALE"],
    restockEmphasis: true,
    showWastageInNavigation: false,
    specialMode: "NONE",
    descriptionKey: "shop_archetypes.description_pet_supply",
    importExample: ["PET-FOOD-1KG", "", "อาหารแมว 1 กก.", "อาหารสัตว์บรรจุถุง", "220", "145", "อาหารสัตว์", "", "อาหารแมว|1kg", "GENERAL", "DIRECT", "PIECE", "1KG", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
  },
  building_materials: {
    archetype: "building_materials",
    recommendedTemplates: GENERAL_TEMPLATE,
    recommendedCapabilities: ["PACK", "MULTI_BARCODE", "UNIT_CONVERSION", "WEIGHTED_PRODUCT", "SERIAL_TRACKING"],
    primarySalesSurfaces: RETAIL_SURFACES,
    recommendedStockSections: ["SCALE"],
    restockEmphasis: true,
    showWastageInNavigation: false,
    specialMode: "NONE",
    descriptionKey: "shop_archetypes.description_building_materials",
    importExample: ["BUILD-CEMENT-50", "", "ปูนซีเมนต์ 50 กก.", "จำหน่ายเป็นถุง", "145", "118", "ปูนซีเมนต์", "", "ปูน|50kg", "GENERAL", "DIRECT", "PIECE", "50KG", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
  },
  restaurant: {
    archetype: "restaurant",
    recommendedTemplates: ["QUICK_MENU", "PREPARED_MENU", "READY_GOOD", "INGREDIENT"],
    recommendedCapabilities: ["RECIPE", "MODIFIER", "KITCHEN_WORKFLOW", "WASTAGE"],
    primarySalesSurfaces: ["RESTAURANT_POS"],
    recommendedStockSections: ["KITCHEN_STATION", "STATION_SLA", "RECIPES", "MODIFIERS"],
    restockEmphasis: false,
    showWastageInNavigation: true,
    specialMode: "RESTAURANT",
    descriptionKey: "shop_archetypes.description_restaurant",
    importExample: ["MENU-KAPRAO", "", "ข้าวกะเพรา", "เมนูปรุงสด", "79", "", "อาหารจานเดียว", "", "กะเพรา|ผัดกะเพรา", "PREPARED_MENU", "RECIPE", "PIECE", "STD", "RESTAURANT_POS"],
  },
  other: {
    archetype: "other",
    recommendedTemplates: GENERAL_TEMPLATE,
    recommendedCapabilities: [],
    primarySalesSurfaces: RETAIL_SURFACES,
    recommendedStockSections: [],
    restockEmphasis: false,
    showWastageInNavigation: false,
    specialMode: "NONE",
    descriptionKey: "shop_archetypes.description_other",
    importExample: ["ITEM-001", "", "สินค้าตัวอย่าง", "สินค้าสต็อกทั่วไป", "100", "60", "ทั่วไป", "", "สินค้า", "GENERAL", "DIRECT", "PIECE", "STD", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
  },
};

export function shopExperienceForArchetype(value: string | null | undefined): ShopExperienceProfile {
  return EXPERIENCES[normalizeShopArchetype(value) ?? "other"];
}

export function additionalProductTemplates(profile: ShopExperienceProfile): ProductCreationTemplate[] {
  const recommended = new Set(profile.recommendedTemplates);
  return PRODUCT_CREATION_TEMPLATES.filter((template) => !recommended.has(template));
}

/**
 * Presentation policy only. Hidden fields remain registered in the product form and the backend
 * remains authoritative. Existing commercial data should call this with expanded=true so an edit
 * never conceals values the shop already saved.
 */
export function productFormFieldVisibility(
  profile: ShopExperienceProfile,
  templateValue: string | null | undefined,
  expanded = false
): ProductFormFieldVisibility {
  const template = PRODUCT_CREATION_TEMPLATES.includes(templateValue as ProductCreationTemplate)
    ? templateValue as ProductCreationTemplate
    : "GENERAL";

  if (profile.specialMode !== "RESTAURANT") {
    const isPreparedMenu = template === "PREPARED_MENU";
    return {
      barcode: !isPreparedMenu,
      shippingWeight: !isPreparedMenu,
      brand: true,
      wholesalePriceTiers: true,
    };
  }

  if (expanded) {
    return { barcode: true, shippingWeight: true, brand: true, wholesalePriceTiers: true };
  }

  const isMenu = template === "QUICK_MENU" || template === "PREPARED_MENU";
  const isPackagedRetailItem = template === "READY_GOOD" || template === "GENERAL";
  return {
    barcode: !isMenu,
    shippingWeight: isPackagedRetailItem,
    brand: isPackagedRetailItem,
    wholesalePriceTiers: false,
  };
}

export const SHOP_EXPERIENCE_PROFILES = EXPERIENCES;
