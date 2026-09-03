// apps/web/lib/bms/restaurantCatalogSeed.ts
// =============================================================
// ข้อมูลแคตตาล็อกร้านอาหารสำหรับ seeder — ไฟล์นี้ตั้งใจไม่ import อะไรเลย
// (กฎเดียวกับ loyaltyMath.ts / pricing.ts) เพื่อให้เทสอ่านตัวข้อมูลจริงได้โดย
// ไม่ต้องมี Postgres · การเขียนลงฐานอยู่ที่ devSeed.ts ตามเดิม
//
// ทำไมต้องแยกออกมา: เมนู/สูตร/สถานี/ตัวเลือกเป็นข้อมูลที่พิมพ์ด้วยมือ พิมพ์รหัส
// วัตถุดิบผิดตัวเดียวคือเมนูที่ขายแล้วไม่ตัดของ ซึ่ง tsc จับไม่ได้ (รหัสเป็น string)
// =============================================================

// =============================================================
// ร้านอาหาร (archetype "restaurant") — แคตตาล็อกของร้านอาหารตามสั่งจริง
// -------------------------------------------------------------
// ก่อนหน้านี้ร้านอาหารยืมชุด `food_beverage` ซึ่งเป็น "อาหารกล่องพร้อมขาย":
// ทุกเมนูเป็น DIRECT มีสต็อกของตัวเอง ไม่มีสถานีครัว ไม่มีสูตร ไม่มีตัวเลือก
// ผลคือทดสอบสิ่งที่ทำให้ร้านอาหารเป็นร้านอาหารไม่ได้เลยสักอย่าง — จอครัวมีแต่
// ช่อง "ไม่ระบุสถานี", SLA ต่อสถานี (9.53) ไม่มีสถานีให้ตั้ง, การตัดวัตถุดิบตาม
// สูตร (9.40) ไม่เคยถูกเรียก, และกล่องเลือกตัวเลือกที่หน้าโต๊ะไม่เคยเด้ง
//
// ชุดนี้จำลองครัวจริง โดยจงใจให้มีครบทั้งสามรูปแบบสต็อกที่ร้านอาหารใช้จริง:
//   · เมนูปรุงสด          → RECIPE     ตัดวัตถุดิบตามสูตรตอนปิดบิล
//   · เครื่องดื่ม/ของบรรจุ → DIRECT     มีสต็อกและบาร์โค้ดจริงให้ยิงสแกน
//   · ข้าวสวย/เครื่องเคียง  → NON_STOCK  ขายเร็ว ไม่คุมสต็อก (9.52)
//   · วัตถุดิบ             → ไม่มีช่องทางขาย จึงไม่โผล่ในเมนู แต่ถูกสูตรตัดได้
// เมนูทุกจานมี `kitchen_station` เสมอ เพราะกระดานครัวจัดกลุ่มด้วยคีย์นี้
// =============================================================

export type RestaurantIngredient = {
  code: string;
  name: string;
  /** หน่วยฐานที่สต็อกและสูตรใช้ร่วมกัน — จำนวนใน bms_inventory เป็น INTEGER เสมอ */
  baseUnit: "GRAM" | "PIECE" | "ML";
  unitLabel: string;
  /** ต้นทุนต่อ 1 หน่วยฐาน (บาท) — รายงานกำไรขั้นต้นและต้นทุนสูตรอ่านค่านี้ */
  costPerUnit: number;
  stock: number;
  category: string;
};

// ต้นทุนอิงราคาตลาดสดโดยประมาณ (หมู ~180 บ./กก. → 0.18 บ./กรัม) เพื่อให้
// การ์ดต้นทุนสูตรที่ /admin/stock-models แสดงตัวเลขที่อ่านแล้วสมเหตุสมผล
export const RESTAURANT_INGREDIENTS: RestaurantIngredient[] = [
  { code: "PORK-MINCE", name: "หมูสับ", baseUnit: "GRAM", unitLabel: "กรัม", costPerUnit: 0.18, stock: 24000, category: "เนื้อสัตว์" },
  { code: "PORK-SLICE", name: "หมูสไลซ์", baseUnit: "GRAM", unitLabel: "กรัม", costPerUnit: 0.2, stock: 18000, category: "เนื้อสัตว์" },
  { code: "PORK-CRISPY", name: "หมูกรอบ", baseUnit: "GRAM", unitLabel: "กรัม", costPerUnit: 0.32, stock: 9000, category: "เนื้อสัตว์" },
  { code: "CHICKEN", name: "เนื้อไก่", baseUnit: "GRAM", unitLabel: "กรัม", costPerUnit: 0.14, stock: 20000, category: "เนื้อสัตว์" },
  { code: "CHICKEN-WING", name: "ปีกไก่", baseUnit: "PIECE", unitLabel: "ชิ้น", costPerUnit: 9, stock: 400, category: "เนื้อสัตว์" },
  { code: "SHRIMP", name: "กุ้งขาว", baseUnit: "GRAM", unitLabel: "กรัม", costPerUnit: 0.42, stock: 9000, category: "อาหารทะเล" },
  { code: "SQUID", name: "ปลาหมึกกล้วย", baseUnit: "GRAM", unitLabel: "กรัม", costPerUnit: 0.35, stock: 6000, category: "อาหารทะเล" },
  { code: "EGG", name: "ไข่ไก่", baseUnit: "PIECE", unitLabel: "ฟอง", costPerUnit: 4.5, stock: 900, category: "ของสด" },
  { code: "RICE", name: "ข้าวสวย (หุงแล้ว)", baseUnit: "GRAM", unitLabel: "กรัม", costPerUnit: 0.02, stock: 90000, category: "ข้าว-เส้น" },
  { code: "NOODLE-YAI", name: "เส้นใหญ่", baseUnit: "GRAM", unitLabel: "กรัม", costPerUnit: 0.05, stock: 9000, category: "ข้าว-เส้น" },
  { code: "NOODLE-LEK", name: "เส้นจันท์", baseUnit: "GRAM", unitLabel: "กรัม", costPerUnit: 0.06, stock: 7000, category: "ข้าว-เส้น" },
  { code: "GLASS-NOODLE", name: "วุ้นเส้น", baseUnit: "GRAM", unitLabel: "กรัม", costPerUnit: 0.08, stock: 4000, category: "ข้าว-เส้น" },
  { code: "BASIL", name: "ใบกะเพรา", baseUnit: "GRAM", unitLabel: "กรัม", costPerUnit: 0.09, stock: 3500, category: "ผัก-สมุนไพร" },
  { code: "GARLIC", name: "กระเทียมสับ", baseUnit: "GRAM", unitLabel: "กรัม", costPerUnit: 0.08, stock: 5000, category: "ผัก-สมุนไพร" },
  { code: "CHILI", name: "พริกขี้หนูสด", baseUnit: "GRAM", unitLabel: "กรัม", costPerUnit: 0.12, stock: 2500, category: "ผัก-สมุนไพร" },
  { code: "VEG-MIX", name: "ผักรวมมิตร", baseUnit: "GRAM", unitLabel: "กรัม", costPerUnit: 0.06, stock: 12000, category: "ผัก-สมุนไพร" },
  { code: "KALE", name: "คะน้าฮ่องกง", baseUnit: "GRAM", unitLabel: "กรัม", costPerUnit: 0.07, stock: 8000, category: "ผัก-สมุนไพร" },
  { code: "MORNING-GLORY", name: "ผักบุ้งไทย", baseUnit: "GRAM", unitLabel: "กรัม", costPerUnit: 0.05, stock: 7000, category: "ผัก-สมุนไพร" },
  { code: "PAPAYA", name: "มะละกอสับเส้น", baseUnit: "GRAM", unitLabel: "กรัม", costPerUnit: 0.04, stock: 6000, category: "ผัก-สมุนไพร" },
  { code: "LIME", name: "มะนาว", baseUnit: "PIECE", unitLabel: "ลูก", costPerUnit: 5, stock: 300, category: "ผัก-สมุนไพร" },
  { code: "TOFU-EGG", name: "เต้าหู้ไข่", baseUnit: "PIECE", unitLabel: "หลอด", costPerUnit: 12, stock: 150, category: "ของสด" },
  { code: "COCONUT-MILK", name: "กะทิกล่อง", baseUnit: "ML", unitLabel: "มล.", costPerUnit: 0.05, stock: 12000, category: "เครื่องปรุง" },
  { code: "CURRY-GREEN", name: "พริกแกงเขียวหวาน", baseUnit: "GRAM", unitLabel: "กรัม", costPerUnit: 0.2, stock: 2500, category: "เครื่องปรุง" },
  { code: "CURRY-RED", name: "พริกแกงเผ็ด", baseUnit: "GRAM", unitLabel: "กรัม", costPerUnit: 0.18, stock: 2500, category: "เครื่องปรุง" },
  { code: "SAUCE-OYSTER", name: "ซอสหอยนางรม", baseUnit: "ML", unitLabel: "มล.", costPerUnit: 0.06, stock: 6000, category: "เครื่องปรุง" },
  { code: "FISH-SAUCE", name: "น้ำปลา", baseUnit: "ML", unitLabel: "มล.", costPerUnit: 0.03, stock: 6000, category: "เครื่องปรุง" },
  { code: "SUGAR", name: "น้ำตาลทราย", baseUnit: "GRAM", unitLabel: "กรัม", costPerUnit: 0.03, stock: 8000, category: "เครื่องปรุง" },
  { code: "TEA-LEAF", name: "ชาไทยผง", baseUnit: "GRAM", unitLabel: "กรัม", costPerUnit: 0.3, stock: 2500, category: "เครื่องดื่ม-วัตถุดิบ" },
  { code: "COFFEE", name: "กาแฟคั่วบด", baseUnit: "GRAM", unitLabel: "กรัม", costPerUnit: 0.55, stock: 2500, category: "เครื่องดื่ม-วัตถุดิบ" },
  { code: "MILK-COND", name: "นมข้นหวาน", baseUnit: "ML", unitLabel: "มล.", costPerUnit: 0.08, stock: 6000, category: "เครื่องดื่ม-วัตถุดิบ" },
  { code: "MILK-EVAP", name: "นมข้นจืด", baseUnit: "ML", unitLabel: "มล.", costPerUnit: 0.06, stock: 6000, category: "เครื่องดื่ม-วัตถุดิบ" },
  { code: "ICE", name: "น้ำแข็งหลอด", baseUnit: "GRAM", unitLabel: "กรัม", costPerUnit: 0.002, stock: 200000, category: "เครื่องดื่ม-วัตถุดิบ" },
];

export type RestaurantModifierOption = {
  code: string;
  name: string;
  priceDelta?: number;
  defaultSelected?: boolean;
};

export type RestaurantModifierGroup = {
  code: string;
  name: string;
  selectionType: "SINGLE" | "MULTIPLE";
  minSelect?: number;
  maxSelect?: number | null;
  options: RestaurantModifierOption[];
};

// กลุ่มตัวเลือกที่ร้านตามสั่งใช้จริง · `price_delta` เป็นข้อมูลแคตตาล็อกฝั่ง server
// เสมอ (9.45) เครื่องขายส่งมาแค่รหัส
//
// SPICE_REQUIRED มี minSelect = 1 อยู่กลุ่มเดียวโดยตั้งใจ — ส้มตำเป็นเมนูที่ร้าน
// ต้องถามความเผ็ดจริง ๆ และเป็นทางเดียวที่จะทดสอบ MODIFIER_GROUP_MIN ได้
// ที่เหลือเป็น minSelect = 0 เพราะกลุ่มบังคับเลือกทำให้สั่งจากช่องทางที่ไม่มี UI
// เลือกตัวเลือก (AI/ออนไลน์/ค้าปลีก) ไม่ได้เลย
export const RESTAURANT_MODIFIER_GROUPS: Record<string, RestaurantModifierGroup> = {
  SPICE: {
    code: "SPICE",
    name: "ระดับความเผ็ด",
    selectionType: "SINGLE",
    maxSelect: 1,
    options: [
      { code: "NO_SPICE", name: "ไม่เผ็ด" },
      { code: "MILD", name: "เผ็ดน้อย" },
      { code: "NORMAL", name: "เผ็ดปกติ", defaultSelected: true },
      { code: "EXTRA_SPICY", name: "เผ็ดมาก" },
    ],
  },
  SPICE_REQUIRED: {
    code: "SPICE",
    name: "เผ็ดกี่เม็ด",
    selectionType: "SINGLE",
    minSelect: 1,
    maxSelect: 1,
    options: [
      { code: "P0", name: "ไม่เผ็ด" },
      { code: "P1", name: "1 เม็ด" },
      { code: "P3", name: "3 เม็ด" },
      { code: "P5", name: "5 เม็ด" },
      { code: "P10", name: "10 เม็ด" },
    ],
  },
  ADD_EGG: {
    code: "ADD_EGG",
    name: "เพิ่มไข่",
    selectionType: "MULTIPLE",
    maxSelect: 2,
    options: [
      { code: "FRIED_EGG", name: "ไข่ดาว", priceDelta: 15 },
      { code: "OMELETTE", name: "ไข่เจียว", priceDelta: 20 },
      { code: "BOILED_EGG", name: "ไข่ต้ม", priceDelta: 15 },
    ],
  },
  PORTION: {
    code: "PORTION",
    name: "เพิ่มปริมาณ",
    selectionType: "MULTIPLE",
    maxSelect: 2,
    options: [
      { code: "SPECIAL", name: "พิเศษ", priceDelta: 15 },
      { code: "MORE_RICE", name: "เพิ่มข้าว", priceDelta: 10 },
    ],
  },
  PREFERENCE: {
    code: "PREFERENCE",
    name: "ความต้องการพิเศษ",
    selectionType: "MULTIPLE",
    options: [
      { code: "NO_VEG", name: "ไม่ใส่ผัก" },
      { code: "NO_CORIANDER", name: "ไม่ใส่ผักชี" },
      { code: "SEPARATE_RICE", name: "แยกข้าว" },
    ],
  },
  SWEETNESS: {
    code: "SWEETNESS",
    name: "ระดับความหวาน",
    selectionType: "SINGLE",
    maxSelect: 1,
    options: [
      { code: "SWEET_LESS", name: "หวานน้อย" },
      { code: "SWEET_NORMAL", name: "หวานปกติ", defaultSelected: true },
      { code: "SWEET_MORE", name: "หวานมาก" },
    ],
  },
  DRINK_EXTRA: {
    code: "DRINK_EXTRA",
    name: "ตัวเลือกเครื่องดื่ม",
    selectionType: "MULTIPLE",
    maxSelect: 2,
    options: [
      { code: "NO_ICE", name: "ไม่ใส่น้ำแข็ง" },
      { code: "EXTRA_SHOT", name: "เพิ่มช็อต", priceDelta: 15 },
      { code: "TAKEAWAY", name: "ใส่แก้วกลับบ้าน", priceDelta: 5 },
    ],
  },
};

export type RestaurantMenuSize = {
  code: string;
  /** ราคาของไซซ์นี้ (ไม่ระบุ = ใช้ราคาสินค้า) เก็บที่ bms_product_packs.price */
  price?: number;
  /** ตัวคูณปริมาณวัตถุดิบของสูตรไซซ์นี้ */
  recipeScale?: number;
};

export type RestaurantMenuItem = {
  code: string;
  name: string;
  category: string;
  /** กระดานครัวจัดกลุ่มด้วยคีย์นี้ และ SLA ของ 9.53 ตั้งค่าต่อสถานี */
  station: string;
  stockPolicy: "RECIPE" | "DIRECT" | "NON_STOCK";
  price: number;
  description: string;
  keywords: string[];
  sizes?: RestaurantMenuSize[];
  /** DIRECT เท่านั้น — ของบรรจุที่นับสต็อกและมีบาร์โค้ดข้างขวด */
  stock?: number;
  brand?: string;
  recipe?: Array<{ code: string; qty: number }>;
  modifierGroups?: Array<keyof typeof RESTAURANT_MODIFIER_GROUPS>;
};

const STATION_WOK = "ครัวร้อน";
const STATION_FRY = "ครัวทอด";
const STATION_COLD = "ครัวตำ-ยำ";
const STATION_BAR = "บาร์เครื่องดื่ม";
const STATION_DESSERT = "ของหวาน";

const RICE_DISH_MODIFIERS: Array<keyof typeof RESTAURANT_MODIFIER_GROUPS> =
  ["SPICE", "ADD_EGG", "PORTION", "PREFERENCE"];

export const RESTAURANT_MENU: RestaurantMenuItem[] = [
  // ---- อาหารจานเดียว (ครัวร้อน · ปรุงสดตามสูตร) ----
  {
    code: "KAPRAO-PORK", name: "ข้าวกะเพราหมูสับ", category: "อาหารจานเดียว", station: STATION_WOK,
    stockPolicy: "RECIPE", price: 79, description: "กะเพราหมูสับรสจัด ผัดไฟแรง เสิร์ฟพร้อมข้าวสวย",
    keywords: ["กะเพรา", "ข้าวกะเพรา", "หมูสับ", "ผัดกะเพรา"],
    recipe: [{ code: "RICE", qty: 250 }, { code: "PORK-MINCE", qty: 90 }, { code: "BASIL", qty: 12 }, { code: "GARLIC", qty: 8 }, { code: "CHILI", qty: 6 }, { code: "FISH-SAUCE", qty: 10 }],
    modifierGroups: RICE_DISH_MODIFIERS,
  },
  {
    code: "KAPRAO-CHICKEN", name: "ข้าวกะเพราไก่", category: "อาหารจานเดียว", station: STATION_WOK,
    stockPolicy: "RECIPE", price: 75, description: "กะเพราไก่สับ เผ็ดหอมใบกะเพรา",
    keywords: ["กะเพราไก่", "ข้าวกะเพรา", "ไก่"],
    recipe: [{ code: "RICE", qty: 250 }, { code: "CHICKEN", qty: 90 }, { code: "BASIL", qty: 12 }, { code: "GARLIC", qty: 8 }, { code: "CHILI", qty: 6 }, { code: "FISH-SAUCE", qty: 10 }],
    modifierGroups: RICE_DISH_MODIFIERS,
  },
  {
    code: "KAPRAO-SEAFOOD", name: "ข้าวกะเพราทะเล", category: "อาหารจานเดียว", station: STATION_WOK,
    stockPolicy: "RECIPE", price: 99, description: "กะเพรากุ้งและปลาหมึกสด",
    keywords: ["กะเพราทะเล", "กุ้ง", "ปลาหมึก"],
    recipe: [{ code: "RICE", qty: 250 }, { code: "SHRIMP", qty: 60 }, { code: "SQUID", qty: 60 }, { code: "BASIL", qty: 12 }, { code: "GARLIC", qty: 8 }, { code: "CHILI", qty: 6 }],
    modifierGroups: RICE_DISH_MODIFIERS,
  },
  {
    code: "FRIEDRICE-PORK", name: "ข้าวผัดหมู", category: "อาหารจานเดียว", station: STATION_WOK,
    stockPolicy: "RECIPE", price: 75, description: "ข้าวผัดหมูใส่ไข่ หอมกระทะ",
    keywords: ["ข้าวผัด", "ข้าวผัดหมู", "หมู"],
    recipe: [{ code: "RICE", qty: 260 }, { code: "PORK-SLICE", qty: 80 }, { code: "EGG", qty: 1 }, { code: "VEG-MIX", qty: 40 }, { code: "SAUCE-OYSTER", qty: 12 }],
    modifierGroups: ["PORTION", "PREFERENCE"],
  },
  {
    code: "FRIEDRICE-SHRIMP", name: "ข้าวผัดกุ้ง", category: "อาหารจานเดียว", station: STATION_WOK,
    stockPolicy: "RECIPE", price: 95, description: "ข้าวผัดกุ้งสด เสิร์ฟพร้อมมะนาวและแตงกวา",
    keywords: ["ข้าวผัดกุ้ง", "กุ้ง", "ข้าวผัด"],
    recipe: [{ code: "RICE", qty: 260 }, { code: "SHRIMP", qty: 90 }, { code: "EGG", qty: 1 }, { code: "VEG-MIX", qty: 40 }, { code: "LIME", qty: 1 }],
    modifierGroups: ["PORTION", "PREFERENCE"],
  },
  {
    code: "PORK-GARLIC", name: "ข้าวหมูกระเทียม", category: "อาหารจานเดียว", station: STATION_WOK,
    stockPolicy: "RECIPE", price: 75, description: "หมูผัดกระเทียมพริกไทย ราดข้าวสวยร้อน ๆ",
    keywords: ["หมูกระเทียม", "ข้าวหมูกระเทียม", "กระเทียม"],
    recipe: [{ code: "RICE", qty: 250 }, { code: "PORK-SLICE", qty: 90 }, { code: "GARLIC", qty: 15 }, { code: "SAUCE-OYSTER", qty: 12 }],
    modifierGroups: ["ADD_EGG", "PORTION", "PREFERENCE"],
  },
  {
    code: "KALE-CRISPYPORK", name: "ข้าวคะน้าหมูกรอบ", category: "อาหารจานเดียว", station: STATION_WOK,
    stockPolicy: "RECIPE", price: 85, description: "คะน้าฮ่องกงผัดหมูกรอบ ราดข้าว",
    keywords: ["คะน้าหมูกรอบ", "หมูกรอบ", "คะน้า"],
    recipe: [{ code: "RICE", qty: 250 }, { code: "PORK-CRISPY", qty: 80 }, { code: "KALE", qty: 90 }, { code: "GARLIC", qty: 8 }, { code: "SAUCE-OYSTER", qty: 15 }],
    modifierGroups: ["SPICE", "ADD_EGG", "PORTION"],
  },
  {
    code: "OMELETTE-RICE", name: "ข้าวไข่เจียวหมูสับ", category: "อาหารจานเดียว", station: STATION_FRY,
    stockPolicy: "RECIPE", price: 69, description: "ไข่เจียวหมูสับฟูกรอบ ราดซอสพริก",
    keywords: ["ไข่เจียว", "ข้าวไข่เจียว", "หมูสับ"],
    recipe: [{ code: "RICE", qty: 250 }, { code: "EGG", qty: 2 }, { code: "PORK-MINCE", qty: 50 }, { code: "FISH-SAUCE", qty: 8 }],
    modifierGroups: ["PORTION", "PREFERENCE"],
  },
  {
    code: "CURRY-GREEN-CHICKEN", name: "ข้าวแกงเขียวหวานไก่", category: "อาหารจานเดียว", station: STATION_WOK,
    stockPolicy: "RECIPE", price: 89, description: "แกงเขียวหวานไก่กะทิสด ราดข้าว",
    keywords: ["แกงเขียวหวาน", "เขียวหวานไก่", "แกง"],
    recipe: [{ code: "RICE", qty: 250 }, { code: "CHICKEN", qty: 90 }, { code: "COCONUT-MILK", qty: 120 }, { code: "CURRY-GREEN", qty: 30 }, { code: "VEG-MIX", qty: 40 }],
    modifierGroups: ["SPICE", "PORTION", "PREFERENCE"],
  },

  {
    code: "PRIKKHING-CRISPYPORK", name: "ข้าวผัดพริกแกงหมูกรอบ", category: "อาหารจานเดียว", station: STATION_WOK,
    stockPolicy: "RECIPE", price: 85, description: "ผัดพริกแกงหมูกรอบใส่ถั่วฝักยาว ราดข้าว",
    keywords: ["ผัดพริกแกง", "พริกขิง", "หมูกรอบ"],
    recipe: [{ code: "RICE", qty: 250 }, { code: "PORK-CRISPY", qty: 80 }, { code: "CURRY-RED", qty: 25 }, { code: "VEG-MIX", qty: 60 }],
    modifierGroups: ["SPICE", "ADD_EGG", "PORTION", "PREFERENCE"],
  },

  // ---- กับข้าว (ครัวร้อน · สั่งแยกจานเล็ก/จานใหญ่) ----
  {
    code: "STIRFRY-MORNINGGLORY", name: "ผัดผักบุ้งไฟแดง", category: "กับข้าว", station: STATION_WOK,
    stockPolicy: "RECIPE", price: 79, description: "ผักบุ้งไทยผัดไฟแรง เต้าเจี้ยวและพริกสด",
    keywords: ["ผัดผักบุ้ง", "ผักบุ้งไฟแดง", "ผัดผัก"],
    sizes: [{ code: "จานเล็ก", price: 79 }, { code: "จานใหญ่", price: 129, recipeScale: 1.6 }],
    recipe: [{ code: "MORNING-GLORY", qty: 180 }, { code: "GARLIC", qty: 10 }, { code: "CHILI", qty: 8 }, { code: "SAUCE-OYSTER", qty: 15 }],
    modifierGroups: ["SPICE", "PREFERENCE"],
  },
  {
    code: "STIRFRY-VEG", name: "ผัดผักรวมมิตร", category: "กับข้าว", station: STATION_WOK,
    stockPolicy: "RECIPE", price: 79, description: "ผักรวมผัดน้ำมันหอย ใส่หมูหรือไก่ได้",
    keywords: ["ผัดผักรวม", "ผัดผัก", "ผักรวมมิตร"],
    sizes: [{ code: "จานเล็ก", price: 79 }, { code: "จานใหญ่", price: 129, recipeScale: 1.6 }],
    recipe: [{ code: "VEG-MIX", qty: 200 }, { code: "PORK-SLICE", qty: 50 }, { code: "GARLIC", qty: 10 }, { code: "SAUCE-OYSTER", qty: 15 }],
    modifierGroups: ["PREFERENCE"],
  },
  {
    code: "TOMYUM-SHRIMP", name: "ต้มยำกุ้งน้ำข้น", category: "ต้ม-แกง", station: STATION_WOK,
    stockPolicy: "RECIPE", price: 149, description: "ต้มยำกุ้งน้ำข้น เผ็ดเปรี้ยวจัดจ้าน",
    keywords: ["ต้มยำกุ้ง", "ต้มยำ", "น้ำข้น"],
    sizes: [{ code: "ถ้วยเล็ก", price: 149 }, { code: "หม้อใหญ่", price: 249, recipeScale: 1.8 }],
    recipe: [{ code: "SHRIMP", qty: 120 }, { code: "MILK-EVAP", qty: 60 }, { code: "CHILI", qty: 10 }, { code: "LIME", qty: 1 }, { code: "FISH-SAUCE", qty: 15 }],
    modifierGroups: ["SPICE", "PREFERENCE"],
  },
  {
    code: "SOUP-TOFU", name: "ต้มจืดเต้าหู้หมูสับ", category: "ต้ม-แกง", station: STATION_WOK,
    stockPolicy: "RECIPE", price: 89, description: "ต้มจืดเต้าหู้ไข่ หมูสับ และผักกาดขาว",
    keywords: ["ต้มจืด", "เต้าหู้", "หมูสับ"],
    recipe: [{ code: "TOFU-EGG", qty: 1 }, { code: "PORK-MINCE", qty: 60 }, { code: "VEG-MIX", qty: 60 }, { code: "FISH-SAUCE", qty: 12 }],
    modifierGroups: ["PREFERENCE"],
  },

  // ---- ตำ-ยำ (ครัวเย็น · คนละคนกับครัวร้อน จึงต้องแยกสถานี) ----
  {
    code: "SOMTAM-THAI", name: "ส้มตำไทย", category: "ตำ-ยำ", station: STATION_COLD,
    stockPolicy: "RECIPE", price: 69, description: "ส้มตำไทยใส่ถั่วลิสงและกุ้งแห้ง",
    keywords: ["ส้มตำ", "ตำไทย", "ส้มตำไทย"],
    recipe: [{ code: "PAPAYA", qty: 180 }, { code: "LIME", qty: 1 }, { code: "CHILI", qty: 8 }, { code: "FISH-SAUCE", qty: 15 }, { code: "SUGAR", qty: 15 }],
    modifierGroups: ["SPICE_REQUIRED", "PREFERENCE"],
  },
  {
    code: "SOMTAM-POO-PLARA", name: "ส้มตำปูปลาร้า", category: "ตำ-ยำ", station: STATION_COLD,
    stockPolicy: "RECIPE", price: 79, description: "ส้มตำปูปลาร้ารสแซ่บ สูตรอีสาน",
    keywords: ["ส้มตำปูปลาร้า", "ตำปลาร้า", "ส้มตำ"],
    recipe: [{ code: "PAPAYA", qty: 180 }, { code: "LIME", qty: 1 }, { code: "CHILI", qty: 12 }, { code: "FISH-SAUCE", qty: 15 }],
    modifierGroups: ["SPICE_REQUIRED", "PREFERENCE"],
  },
  {
    code: "LARB-PORK", name: "ลาบหมู", category: "ตำ-ยำ", station: STATION_COLD,
    stockPolicy: "RECIPE", price: 89, description: "ลาบหมูข้าวคั่วหอม โรยหอมแดงและใบสะระแหน่",
    keywords: ["ลาบหมู", "ลาบ", "อีสาน"],
    recipe: [{ code: "PORK-MINCE", qty: 120 }, { code: "LIME", qty: 1 }, { code: "CHILI", qty: 10 }, { code: "FISH-SAUCE", qty: 15 }],
    modifierGroups: ["SPICE", "PREFERENCE"],
  },
  {
    code: "YAM-GLASSNOODLE", name: "ยำวุ้นเส้นทะเล", category: "ตำ-ยำ", station: STATION_COLD,
    stockPolicy: "RECIPE", price: 129, description: "ยำวุ้นเส้นกุ้งและปลาหมึก รสเปรี้ยวเผ็ด",
    keywords: ["ยำวุ้นเส้น", "วุ้นเส้น", "ยำ"],
    recipe: [{ code: "GLASS-NOODLE", qty: 90 }, { code: "SHRIMP", qty: 70 }, { code: "SQUID", qty: 70 }, { code: "LIME", qty: 1 }, { code: "CHILI", qty: 10 }],
    modifierGroups: ["SPICE", "PREFERENCE"],
  },

  // ---- เส้น (ครัวร้อน) ----
  {
    code: "PADTHAI-SHRIMP", name: "ผัดไทยกุ้งสด", category: "เส้น", station: STATION_WOK,
    stockPolicy: "RECIPE", price: 99, description: "ผัดไทยเส้นจันท์กุ้งสด เสิร์ฟพร้อมถั่วงอกและมะนาว",
    keywords: ["ผัดไทย", "ผัดไทยกุ้ง", "เส้นจันท์"],
    recipe: [{ code: "NOODLE-LEK", qty: 150 }, { code: "SHRIMP", qty: 80 }, { code: "EGG", qty: 1 }, { code: "SUGAR", qty: 20 }, { code: "LIME", qty: 1 }],
    modifierGroups: ["PORTION", "PREFERENCE"],
  },
  {
    code: "RADNA-PORK", name: "ราดหน้าหมูนุ่ม", category: "เส้น", station: STATION_WOK,
    stockPolicy: "RECIPE", price: 79, description: "เส้นใหญ่ราดหน้าหมูนุ่มและคะน้าฮ่องกง",
    keywords: ["ราดหน้า", "หมูนุ่ม", "เส้นใหญ่"],
    recipe: [{ code: "NOODLE-YAI", qty: 180 }, { code: "PORK-SLICE", qty: 80 }, { code: "KALE", qty: 70 }, { code: "SAUCE-OYSTER", qty: 15 }],
    modifierGroups: ["PREFERENCE"],
  },
  {
    code: "PADSEEEW-PORK", name: "ผัดซีอิ๊วหมู", category: "เส้น", station: STATION_WOK,
    stockPolicy: "RECIPE", price: 79, description: "เส้นใหญ่ผัดซีอิ๊วไฟแรง ใส่ไข่และคะน้า",
    keywords: ["ผัดซีอิ๊ว", "เส้นใหญ่", "ผัดซีอิ๊วหมู"],
    recipe: [{ code: "NOODLE-YAI", qty: 180 }, { code: "PORK-SLICE", qty: 80 }, { code: "EGG", qty: 1 }, { code: "KALE", qty: 60 }],
    modifierGroups: ["PREFERENCE"],
  },

  // ---- ของทานเล่น (ครัวทอด) ----
  {
    code: "WING-FISHSAUCE", name: "ปีกไก่ทอดน้ำปลา", category: "ของทานเล่น", station: STATION_FRY,
    stockPolicy: "RECIPE", price: 99, description: "ปีกไก่ทอดน้ำปลาหอมกรอบ 5 ชิ้น",
    keywords: ["ปีกไก่ทอด", "ไก่ทอดน้ำปลา", "ของทานเล่น"],
    recipe: [{ code: "CHICKEN-WING", qty: 5 }, { code: "FISH-SAUCE", qty: 20 }, { code: "GARLIC", qty: 10 }],
  },
  {
    code: "SQUID-FRIED", name: "ปลาหมึกทอดกระเทียม", category: "ของทานเล่น", station: STATION_FRY,
    stockPolicy: "RECIPE", price: 129, description: "ปลาหมึกกล้วยทอดกระเทียมพริกไทย",
    keywords: ["ปลาหมึกทอด", "ปลาหมึก", "ทอดกระเทียม"],
    recipe: [{ code: "SQUID", qty: 150 }, { code: "GARLIC", qty: 15 }],
  },

  // ---- ข้าว-เครื่องเคียง (ขายเร็ว ไม่คุมสต็อก) ----
  {
    code: "RICE-PLAIN", name: "ข้าวสวย", category: "ข้าว-เครื่องเคียง", station: STATION_WOK,
    stockPolicy: "NON_STOCK", price: 15, description: "ข้าวสวยหอมมะลิ 1 จาน",
    keywords: ["ข้าวสวย", "ข้าวเปล่า", "ข้าว"],
  },
  {
    code: "RICE-STICKY", name: "ข้าวเหนียว", category: "ข้าว-เครื่องเคียง", station: STATION_WOK,
    stockPolicy: "NON_STOCK", price: 15, description: "ข้าวเหนียวนึ่ง 1 กระติบเล็ก",
    keywords: ["ข้าวเหนียว", "ข้าวเหนียวนึ่ง"],
  },
  {
    code: "EGG-FRIED-SIDE", name: "ไข่ดาว (เพิ่ม)", category: "ข้าว-เครื่องเคียง", station: STATION_FRY,
    stockPolicy: "NON_STOCK", price: 15, description: "ไข่ดาวเพิ่ม 1 ฟอง",
    keywords: ["ไข่ดาว", "เพิ่มไข่", "ไข่"],
  },

  // ---- เครื่องดื่มชง (บาร์) ----
  {
    code: "THAITEA-ICED", name: "ชาไทยเย็น", category: "เครื่องดื่ม", station: STATION_BAR,
    stockPolicy: "RECIPE", price: 45, description: "ชาไทยเย็นสูตรร้าน หวานมันกลมกล่อม",
    keywords: ["ชาไทย", "ชาเย็น", "ชานมเย็น"],
    recipe: [{ code: "TEA-LEAF", qty: 12 }, { code: "MILK-COND", qty: 30 }, { code: "MILK-EVAP", qty: 30 }, { code: "SUGAR", qty: 10 }, { code: "ICE", qty: 200 }],
    modifierGroups: ["SWEETNESS", "DRINK_EXTRA"],
  },
  {
    code: "LIMETEA-ICED", name: "ชามะนาว", category: "เครื่องดื่ม", station: STATION_BAR,
    stockPolicy: "RECIPE", price: 40, description: "ชามะนาวเย็นชื่นใจ",
    keywords: ["ชามะนาว", "ชาเย็น", "มะนาว"],
    recipe: [{ code: "TEA-LEAF", qty: 10 }, { code: "LIME", qty: 1 }, { code: "SUGAR", qty: 15 }, { code: "ICE", qty: 200 }],
    modifierGroups: ["SWEETNESS", "DRINK_EXTRA"],
  },
  {
    code: "COFFEE-ICED", name: "กาแฟเย็น", category: "เครื่องดื่ม", station: STATION_BAR,
    stockPolicy: "RECIPE", price: 50, description: "กาแฟเย็นคั่วเข้ม",
    keywords: ["กาแฟเย็น", "กาแฟ", "โอเลี้ยง"],
    recipe: [{ code: "COFFEE", qty: 18 }, { code: "MILK-COND", qty: 30 }, { code: "SUGAR", qty: 10 }, { code: "ICE", qty: 200 }],
    modifierGroups: ["SWEETNESS", "DRINK_EXTRA"],
  },

  // ---- เครื่องดื่มบรรจุ (มีบาร์โค้ดจริง ยิงสแกนได้ นับสต็อกได้) ----
  {
    code: "WATER-600", name: "น้ำดื่ม 600 มล.", category: "เครื่องดื่ม", station: STATION_BAR,
    stockPolicy: "DIRECT", price: 15, stock: 240, brand: "สิงห์",
    description: "น้ำดื่มบรรจุขวด 600 มล.", keywords: ["น้ำเปล่า", "น้ำดื่ม", "น้ำขวด"],
  },
  {
    code: "COKE-325", name: "โค้ก 325 มล.", category: "เครื่องดื่ม", station: STATION_BAR,
    stockPolicy: "DIRECT", price: 25, stock: 180, brand: "Coca-Cola",
    description: "โค้กกระป๋อง 325 มล. แช่เย็น", keywords: ["โค้ก", "น้ำอัดลม", "coke"],
  },
  {
    code: "SODA-325", name: "โซดา 325 มล.", category: "เครื่องดื่ม", station: STATION_BAR,
    stockPolicy: "DIRECT", price: 20, stock: 150, brand: "สิงห์",
    description: "โซดาขวดเล็กสำหรับผสมหรือดื่มเปล่า", keywords: ["โซดา", "น้ำโซดา"],
  },
  {
    code: "BEER-620", name: "เบียร์ 620 มล.", category: "เครื่องดื่ม", station: STATION_BAR,
    stockPolicy: "DIRECT", price: 120, stock: 96, brand: "สิงห์",
    description: "เบียร์ขวดใหญ่ 620 มล. เสิร์ฟพร้อมน้ำแข็ง", keywords: ["เบียร์", "beer", "ขวดใหญ่"],
  },

  // ---- ของหวาน ----
  {
    code: "MANGO-STICKYRICE", name: "ข้าวเหนียวมะม่วง", category: "ของหวาน", station: STATION_DESSERT,
    stockPolicy: "RECIPE", price: 89, description: "ข้าวเหนียวมูนกะทิสดกับมะม่วงสุก",
    keywords: ["ข้าวเหนียวมะม่วง", "ของหวาน", "มะม่วง"],
    recipe: [{ code: "COCONUT-MILK", qty: 80 }, { code: "SUGAR", qty: 30 }],
  },
  {
    code: "ICECREAM-COCONUT", name: "ไอศกรีมกะทิ", category: "ของหวาน", station: STATION_DESSERT,
    stockPolicy: "DIRECT", price: 45, stock: 60,
    description: "ไอศกรีมกะทิโฮมเมด 1 ถ้วย", keywords: ["ไอศกรีม", "ไอติมกะทิ", "ของหวาน"],
  },
];

export function restaurantPackUnitName(item: RestaurantMenuItem): string {
  if (item.code === "COKE-325") return "กระป๋อง";
  if (item.category === "เครื่องดื่ม") return item.stockPolicy === "DIRECT" ? "ขวด" : "แก้ว";
  if (item.category === "ของหวาน" || item.category === "ต้ม-แกง") return "ถ้วย";
  if (item.category === "ข้าว-เครื่องเคียง") return "ที่";
  return "จาน";
}

export const RESTAURANT_MENU_SERIES = ["สูตรพิเศษ", "เมนูแนะนำ", "ชุดอิ่มคุ้ม", "สูตรต้นตำรับ"];

// ขอเมนูมากกว่าที่ครัวจริงมี ก็ยังต้องอ่านเป็นชื่ออาหาร ไม่ใช่ "· รุ่น Pro"
export function restaurantMenuName(item: RestaurantMenuItem, index: number) {
  const cycle = Math.floor(index / RESTAURANT_MENU.length);
  if (cycle === 0) return item.name;
  const label = RESTAURANT_MENU_SERIES[(cycle - 1) % RESTAURANT_MENU_SERIES.length];
  const series = Math.floor((cycle - 1) / RESTAURANT_MENU_SERIES.length) + 1;
  return `${item.name} · ${label}${series > 1 ? ` ${series}` : ""}`;
}

export const RESTAURANT_DEFAULT_SIZES: RestaurantMenuSize[] = [{ code: "STD" }];
