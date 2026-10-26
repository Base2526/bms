import { normalizeShopArchetype, type ShopArchetype } from "./shopArchetypes";
import { inStoreBarcode } from "./barcode";
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
  /** Example rows written to the downloadable Products sheet for this archetype. */
  importExamples: readonly (readonly string[])[];
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
    importExamples: [
      ["MM-WATER-600", inStoreBarcode(1), "น้ำดื่ม 600 มล.", "สินค้าขายเป็นชิ้น", "10", "6", "เครื่องดื่ม", "แบรนด์ตัวอย่าง", "น้ำดื่ม|600ml", "GENERAL", "DIRECT", "PIECE", "STD", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
      ["MM-SODA-PACK", "", "โซดาแพ็ก 6 ขวด", "ต้องเพิ่มหน่วยขาย 6 ขวดในหน้าหน่วยบรรจุก่อนเปิดขาย", "72", "48", "เครื่องดื่ม", "", "โซดา|แพ็ก", "GENERAL", "PACK", "BOTTLE", "STD", "RETAIL_POS|PUBLIC_STOREFRONT|ONLINE_ORDER"],
      ["MM-BANANA-KG", "", "กล้วยหอมชั่งกิโล", "สินค้าชั่งน้ำหนัก ต้องตั้งค่าเครื่องชั่งก่อนเปิดขาย", "65", "38", "ผักผลไม้", "", "กล้วย|ชั่งกิโล", "GENERAL", "WEIGHTED", "KG", "STD", "RETAIL_POS"],
    ],
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
    importExamples: [
      ["FASHION-TEE-01", inStoreBarcode(2), "เสื้อยืด Cotton Relaxed", "เสื้อยืดมีหลายไซซ์", "490", "220", "เสื้อผ้า", "แบรนด์ตัวอย่าง", "เสื้อยืด|cotton", "GENERAL", "DIRECT", "PIECE", "S|M|L|XL", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
    ],
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
    importExamples: [
      ["HOME-PAN", inStoreBarcode(3), "กระทะสเตนเลส", "กระทะหลายขนาด", "890", "520", "เครื่องครัว", "แบรนด์ตัวอย่าง", "กระทะ|สเตนเลส", "GENERAL", "DIRECT", "PIECE", "24CM|28CM", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
    ],
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
    importExamples: [
      ["BEAUTY-SERUM", inStoreBarcode(4), "Barrier Serum", "เซรั่มหลายขนาด ควรตั้ง lot และวันหมดอายุ", "590", "280", "เซรั่ม", "แบรนด์ตัวอย่าง", "เซรั่ม|barrier", "GENERAL", "DIRECT", "PIECE", "15ML|30ML", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
    ],
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
    importExamples: [
      ["FOOD-COOKIE-01", inStoreBarcode(5), "คุกกี้ช็อกโกแลต", "ขนมพร้อมขาย", "65", "28", "เบเกอรี่", "แบรนด์ตัวอย่าง", "คุกกี้|ช็อกโกแลต", "GENERAL", "DIRECT", "PIECE", "STD", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
    ],
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
    importExamples: [
      ["GADGET-CASE-IP15", inStoreBarcode(6), "เคสสำหรับ iPhone 15", "เคสกันกระแทก", "390", "150", "เคส", "แบรนด์ตัวอย่าง", "เคส|iphone 15", "GENERAL", "DIRECT", "PIECE", "BLACK|CLEAR", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
      ["GADGET-PHONE-01", "", "โทรศัพท์ตัวอย่าง", "ติดตามหมายเลขเครื่องแยกชิ้น", "12900", "9900", "โทรศัพท์", "แบรนด์ตัวอย่าง", "โทรศัพท์|serial", "GENERAL", "SERIALIZED", "PIECE", "128GB|256GB", "RETAIL_POS|PUBLIC_STOREFRONT|ONLINE_ORDER"],
    ],
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
    importExamples: [
      ["B2B-PAPER-A4", inStoreBarcode(7), "กระดาษ A4", "ขายเป็นรีมและลัง ต้องเพิ่มหน่วยขายลังในหน้าหน่วยบรรจุก่อนเปิดขาย", "125", "92", "อุปกรณ์สำนักงาน", "แบรนด์ตัวอย่าง", "กระดาษ|a4|รีม", "GENERAL", "PACK", "REAM", "70GSM|80GSM", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
    ],
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
    importExamples: [
      ["GIFT-SET-01", "", "ชุดของขวัญ Everyday", "Bundle ที่ต้องกำหนดส่วนประกอบก่อนเปิดขาย", "790", "390", "Gift Set", "แบรนด์ตัวอย่าง", "ของขวัญ|gift set", "GENERAL", "BUNDLE", "PIECE", "STD", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
    ],
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
    importExamples: [
      ["PHARMACY-ITEM-01", inStoreBarcode(8), "สินค้าสุขภาพตัวอย่าง", "ต้องตั้งนโยบายและข้อมูลกำกับก่อนเปิดขาย", "120", "70", "สินค้าสุขภาพ", "แบรนด์ตัวอย่าง", "สุขภาพ", "GENERAL", "DIRECT", "PIECE", "STD", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
    ],
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
    importExamples: [
      ["PET-CAT-FOOD", inStoreBarcode(9), "อาหารแมว", "อาหารสัตว์หลายขนาด ควรตั้ง lot และวันหมดอายุ", "220", "145", "อาหารสัตว์", "แบรนด์ตัวอย่าง", "อาหารแมว|cat food", "GENERAL", "DIRECT", "PIECE", "1KG|3KG", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
    ],
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
    importExamples: [
      ["BUILD-CEMENT-50", inStoreBarcode(10), "ปูนซีเมนต์ 50 กก.", "จำหน่ายเป็นถุง", "145", "118", "ปูนซีเมนต์", "แบรนด์ตัวอย่าง", "ปูน|50kg", "GENERAL", "DIRECT", "BAG", "STD", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
      ["BUILD-SAND-KG", "", "ทรายแบ่งชั่งกิโล", "สินค้าชั่งน้ำหนัก ต้องตั้งค่าหน่วยและเครื่องชั่งก่อนเปิดขาย", "8", "4", "วัสดุก่อสร้าง", "", "ทราย|ชั่งน้ำหนัก", "GENERAL", "WEIGHTED", "KG", "หยาบ|ละเอียด", "RETAIL_POS"],
    ],
  },
  restaurant: {
    archetype: "restaurant",
    recommendedTemplates: ["QUICK_MENU", "PREPARED_MENU", "READY_GOOD", "INGREDIENT"],
    recommendedCapabilities: ["RECIPE", "MODIFIER", "KITCHEN_WORKFLOW", "WASTAGE"],
    primarySalesSurfaces: ["RESTAURANT_POS", "CUSTOMER_AI", "ONLINE_ORDER"],
    recommendedStockSections: ["KITCHEN_STATION", "STATION_SLA", "RECIPES", "MODIFIERS"],
    restockEmphasis: false,
    showWastageInNavigation: true,
    specialMode: "RESTAURANT",
    descriptionKey: "shop_archetypes.description_restaurant",
    importExamples: [
      ["MENU-NONSTOCK", "", "ค่าบริการเปิดขวด", "รายการไม่ตัดสต็อก", "50", "", "ค่าบริการ", "", "ค่าบริการ", "QUICK_MENU", "NON_STOCK", "PIECE", "STD", "RESTAURANT_POS"],
      ["MENU-KAPRAO", "", "ข้าวกะเพรา", "เมนูปรุงสด ต้องกำหนดสูตรก่อนเปิดขาย", "79", "", "อาหารจานเดียว", "", "กะเพรา|ผัดกะเพรา", "PREPARED_MENU", "RECIPE", "PIECE", "หมู|ไก่", "RESTAURANT_POS|CUSTOMER_AI|ONLINE_ORDER"],
      ["MENU-WATER", inStoreBarcode(11), "น้ำดื่มแช่เย็น", "สินค้าพร้อมขายและตัดสต็อกตรง", "15", "8", "เครื่องดื่ม", "แบรนด์ตัวอย่าง", "น้ำดื่ม", "READY_GOOD", "DIRECT", "BOTTLE", "STD", "RESTAURANT_POS|RETAIL_POS"],
      ["ING-PORK", "", "หมูสับ", "วัตถุดิบภายใน ไม่แสดงในช่องทางขาย", "0", "120", "วัตถุดิบ", "", "หมูสับ|วัตถุดิบ", "INGREDIENT", "DIRECT", "KG", "STD", ""],
    ],
  },
  board_game_cafe: {
    archetype: "board_game_cafe",
    recommendedTemplates: GENERAL_TEMPLATE,
    recommendedCapabilities: ["PACK", "MULTI_BARCODE"],
    primarySalesSurfaces: RETAIL_SURFACES,
    recommendedStockSections: [],
    restockEmphasis: false,
    showWastageInNavigation: false,
    specialMode: "NONE",
    descriptionKey: "shop_archetypes.description_board_game_cafe",
    importExamples: [
      ["BGC-SLEEVE", inStoreBarcode(12), "ซองใส่การ์ด", "สินค้าเสริมสำหรับขายหน้าร้าน ไม่ใช่เกมที่ให้ยืมเล่น", "120", "70", "Board Game Accessories", "แบรนด์ตัวอย่าง", "ซองการ์ด|board game|sleeve", "GENERAL", "DIRECT", "PIECE", "STANDARD|JAPANESE", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
    ],
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
    importExamples: [
      ["ITEM-001", inStoreBarcode(13), "สินค้าตัวอย่าง", "สินค้าสต็อกทั่วไป", "100", "60", "ทั่วไป", "แบรนด์ตัวอย่าง", "สินค้า", "GENERAL", "DIRECT", "PIECE", "STD", "RETAIL_POS|PUBLIC_STOREFRONT|CUSTOMER_AI|ONLINE_ORDER"],
    ],
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
