export const SHOP_ARCHETYPE_OPTIONS = [
  { value: "mini_mart", label: "Mini Mart / Grocery" },
  { value: "fashion", label: "Fashion & Apparel" },
  { value: "home_kitchen", label: "Home & Kitchen" },
  { value: "beauty_personal_care", label: "Beauty & Personal Care" },
  { value: "food_beverage", label: "Food & Beverage" },
  { value: "gadgets_accessories", label: "Gadgets & Accessories" },
  { value: "b2b_wholesale", label: "B2B / Wholesale" },
  { value: "gifts_seasonal", label: "Gifts & Seasonal" },
  { value: "pharmacy", label: "Pharmacy" },
  { value: "pet_supply", label: "Pet Supply" },
  { value: "building_materials", label: "Building Materials" },
  { value: "restaurant", label: "Restaurant" },
  { value: "other", label: "Other" },
] as const;

export type ShopArchetype = typeof SHOP_ARCHETYPE_OPTIONS[number]["value"];

export const SHOP_ARCHETYPE_SET = new Set<string>(SHOP_ARCHETYPE_OPTIONS.map((x) => x.value));

export function normalizeShopArchetype(value: string | null | undefined): ShopArchetype | null {
  const normalized = value?.trim() || "";
  return normalized && SHOP_ARCHETYPE_SET.has(normalized) ? (normalized as ShopArchetype) : null;
}

export function isValidShopArchetype(value: string | null | undefined): boolean {
  return value == null || value === "" || SHOP_ARCHETYPE_SET.has(value);
}

export function archetypeToBusinessType(value: string | null | undefined): string {
  switch (value) {
    case "fashion":
      return "fashion";
    case "home_kitchen":
      return "home";
    case "beauty_personal_care":
      return "beauty";
    case "food_beverage":
    case "restaurant":
      return "food";
    case "building_materials":
      return "home";
    case "gadgets_accessories":
      return "electronics";
    default:
      return "general";
  }
}

export function archetypeNeedsRestockEmphasis(value: string | null | undefined): boolean {
  return value === "mini_mart" ||
    value === "fashion" ||
    value === "beauty_personal_care" ||
    value === "gadgets_accessories" ||
    value === "home_kitchen" ||
    value === "pet_supply" ||
    value === "building_materials";
}

export type ArchetypeCommercePolicy = {
  salesMotion: string;
  discovery: string;
  basket: string;
  repeatPurchase: string;
  fulfillment: string;
};

export function commercePolicyForArchetype(value: string | null | undefined): ArchetypeCommercePolicy {
  switch (value) {
    case "mini_mart":
      return { salesMotion: "quick_replenishment", discovery: "ค้นด้วยชื่อเรียกทั่วไป/ขนาดและลดคำถามที่ไม่จำเป็น", basket: "เสนอของใช้คู่กันเพียง 1 รายการเมื่อเกี่ยวข้อง", repeatPurchase: "ให้ความสำคัญกับ reorder และ restock opt-in", fulfillment: "สรุปจำนวนและความพร้อมส่งให้เร็ว" };
    case "fashion":
      return { salesMotion: "variant_fit", discovery: "ยืนยันรุ่น สี และไซซ์จากตัวเลือกจริง", basket: "เสนอสินค้าเข้าชุดหรือ variant ทดแทนจาก catalog", repeatPurchase: "เน้น restock ของไซซ์/สีที่ลูกค้ายืนยัน", fulfillment: "ย้ำ variant ในสรุปออเดอร์" };
    case "home_kitchen":
      return { salesMotion: "use_case_comparison", discovery: "ถาม use case หลัก 1 ข้อแล้วเทียบวัสดุ/ขนาดจากข้อมูลจริง", basket: "เสนอเป็นชุดเมื่อสินค้าใน catalog รองรับ", repeatPurchase: "ใช้ restock กับรุ่นที่ลูกค้ารอได้", fulfillment: "อ้างนโยบายจัดส่งของร้านสำหรับของแตกง่าย/ชิ้นใหญ่เท่านั้น" };
    case "beauty_personal_care":
      return { salesMotion: "consultative_routine", discovery: "เริ่มจากเป้าหมายการใช้งานโดยไม่วินิจฉัยทางการแพทย์", basket: "เสนอ routine สั้นจากสินค้าจริง ไม่กล่าวอ้างผลเกินข้อมูลสินค้า", repeatPurchase: "เน้น reorder และ restock สำหรับสินค้าที่ใช้ต่อเนื่อง", fulfillment: "สรุปลำดับรายการและจำนวนให้ชัด" };
    case "food_beverage":
      return { salesMotion: "menu_fast_checkout", discovery: "รับหลายรายการในข้อความเดียวและยืนยันเฉพาะ option ที่มีจริง", basket: "เสนอ add-on เดียวเมื่อ catalog มีสินค้าเกี่ยวข้อง", repeatPurchase: "ใช้ reorder สำหรับเมนูเดิม; restock ไม่ใช่ CTA หลัก", fulfillment: "ให้ความสำคัญกับเวลาร้านและระยะจัดส่งที่ตั้งค่าไว้" };
    case "gadgets_accessories":
      return { salesMotion: "compatibility_bundle", discovery: "ตรวจรุ่น/compatibility จากข้อมูลสินค้า ห้ามตอบจากความจำ", basket: "เสนอ accessory bundle ที่เข้ากันจาก catalog", repeatPurchase: "เน้น alternative และ restock รุ่นยอดนิยม", fulfillment: "ย้ำรุ่นและ variant ก่อนสร้างออเดอร์" };
    case "b2b_wholesale":
      return { salesMotion: "bulk_quote_reorder", discovery: "ถามจำนวนและสเปกหลักเพื่อรองรับ bulk order", basket: "เสนอใบเสนอราคาหรือซื้อซ้ำเมื่อบริบทเหมาะสม", repeatPurchase: "ให้ความสำคัญกับ reorder; อย่าสัญญาราคาส่งที่ backend ไม่ได้ยืนยัน", fulfillment: "สรุปจำนวนรวมและขั้นตอนส่งต่อฝ่ายขาย" };
    case "gifts_seasonal":
      return { salesMotion: "occasion_budget", discovery: "ค้นตามโอกาส ผู้รับ และงบ โดยถามทีละ 1 ประเด็น", basket: "เสนอชุดหรือทางเลือก 3-5 รายการภายในงบจาก catalog", repeatPurchase: "ใช้แคมเปญ/คูปองที่ตรวจสอบแล้ว; restock ตามความเหมาะสม", fulfillment: "ถามกำหนดใช้ของเฉพาะเมื่อจำเป็นต่อการเลือกสินค้า" };
    // ก่อนหน้านี้ pharmacy ตกไปที่ default ซึ่งไม่บอกอะไรเรื่องรับหลายรายการเลย
    // ลูกค้าที่ทัก "อยากได้ พารา 1 แผง, ยาแดง 1 ขวด, ยาแก้ปวด" จึงถูกไล่ถามทีละตัว
    // discovery จงใจย้ำ "ห้ามเดา SKU/ความแรง" เพราะการเลือกยาแทนคนคือการตัดสินใจ
    // ทางคลินิก ไม่ใช่ปัญหา UX ที่แก้ด้วยการเดาให้จบเร็ว
    case "pharmacy":
      return { salesMotion: "named_product_or_pharmacist", discovery: "รับหลายรายการในข้อความเดียวได้ แต่ห้ามเดา SKU/ความแรง/ขนาดบรรจุ ถ้าคำที่ลูกค้าใช้ตรงกับสินค้าหลายตัวให้ลูกค้าเลือกจากรายการจริงใน catalog เท่านั้น ถ้าไม่ตรงเลยให้บอกตรง ๆ ห้ามเสนอยาตัวอื่นแทน", basket: "ยืนยันทุกรายการที่ลูกค้าขอในบิลเดียว รายการที่ยังไม่ชัดต้องถามกลับ ห้ามตัดออกเงียบ ๆ และห้ามเติมจำนวนที่ลูกค้าไม่ได้บอก", repeatPurchase: "ใช้ reorder ได้เฉพาะสินค้าที่ไม่ต้องให้เภสัชกรประเมิน", fulfillment: "รายการที่ต้องให้เภสัชกรตรวจ ให้แจ้งว่าเภสัชกรจะตรวจและให้เลขเคสติดตาม ห้ามยืนยันการขายหรือแนะนำการใช้ยาเอง" };
    case "pet_supply":
      return { salesMotion: "pet_need_replenishment", discovery: "ยืนยันชนิดสัตว์ ช่วงวัย ขนาดบรรจุ และสินค้าจริงจาก catalog", basket: "เสนออุปกรณ์หรือขนาดบรรจุที่เกี่ยวข้องจาก catalog เพียงรายการเดียว", repeatPurchase: "ให้ความสำคัญกับ reorder อาหารและ restock สินค้าที่ใช้ประจำ", fulfillment: "ย้ำหน่วยขายและจำนวน โดยเฉพาะสินค้าถุงกับสินค้าแบ่งขาย" };
    case "building_materials":
      return { salesMotion: "spec_quantity_quote", discovery: "ยืนยันสเปก หน่วยขาย และจำนวนที่ต้องใช้ก่อนสรุปราคา", basket: "เสนอสินค้าที่ใช้ร่วมกันจากข้อมูล compatibility ที่ตรวจสอบแล้ว", repeatPurchase: "เน้นใบเสนอราคาและ reorder ตามหน่วยเดิม", fulfillment: "สรุปทั้งหน่วยขายและปริมาณหน่วยฐาน รวมถึงเงื่อนไขจัดส่งของชิ้นใหญ่" };
    case "restaurant":
      return { salesMotion: "menu_kitchen_checkout", discovery: "รับหลายเมนูและยืนยันเฉพาะตัวเลือกหรือ modifier ที่ร้านตั้งไว้", basket: "เสนอ add-on เดียวจากเมนูจริง", repeatPurchase: "ใช้ reorder สำหรับเมนูเดิม", fulfillment: "ยืนยันรายการ ตัวเลือก และเวลารับหรือจัดส่งก่อนส่งเข้าครัว" };
    default:
      return { salesMotion: "catalog_guided", discovery: "ค้น catalog ก่อนและถามข้อมูลที่ขาดทีละ 1 ข้อ", basket: "เสนอทางเลือกหรือสินค้าที่เกี่ยวข้องจาก catalog เท่านั้น", repeatPurchase: "ใช้ reorder/restock ตามเจตนาที่ลูกค้ายืนยัน", fulfillment: "ใช้เฉพาะ payment/shipping policy ที่ร้านตั้งค่าไว้" };
  }
}

// คืน **i18n key** (ไม่ใช่ข้อความ) เพราะ checklist นี้เป็น admin UI copy ที่ต้องสลับภาษาตาม
// ผู้ใช้ — ต่างจาก commercePolicyForArchetype() ด้านบนที่เป็นเนื้อหาป้อน AI prompt ให้ตอบลูกค้า
// ชาวไทย จึงต้องคงภาษาไทยไว้เสมอ. ผู้เรียก resolve ด้วย t(`admin_getting_started.${key}`)
export function onboardingChecklistKeysForArchetype(value: string | null | undefined): string[] {
  switch (value) {
    case "mini_mart":
      return [
        "checklist_mini_mart_1",
        "checklist_mini_mart_2",
        "checklist_mini_mart_3",
        "checklist_mini_mart_4",
      ];
    case "fashion":
      return [
        "checklist_fashion_1",
        "checklist_fashion_2",
        "checklist_fashion_3",
        "checklist_fashion_4",
      ];
    case "home_kitchen":
      return [
        "checklist_home_kitchen_1",
        "checklist_home_kitchen_2",
        "checklist_home_kitchen_3",
        "checklist_home_kitchen_4",
      ];
    case "beauty_personal_care":
      return [
        "checklist_beauty_personal_care_1",
        "checklist_beauty_personal_care_2",
        "checklist_beauty_personal_care_3",
        "checklist_beauty_personal_care_4",
      ];
    case "food_beverage":
      return [
        "checklist_food_beverage_1",
        "checklist_food_beverage_2",
        "checklist_food_beverage_3",
        "checklist_food_beverage_4",
      ];
    case "gadgets_accessories":
      return [
        "checklist_gadgets_accessories_1",
        "checklist_gadgets_accessories_2",
        "checklist_gadgets_accessories_3",
        "checklist_gadgets_accessories_4",
      ];
    case "pharmacy":
      return [
        "checklist_pharmacy_1",
        "checklist_pharmacy_2",
        "checklist_pharmacy_3",
        "checklist_pharmacy_4",
      ];
    case "b2b_wholesale":
      return [
        "checklist_b2b_wholesale_1",
        "checklist_b2b_wholesale_2",
        "checklist_b2b_wholesale_3",
        "checklist_b2b_wholesale_4",
      ];
    case "b2b_wholesale":
      return [
        "checklist_b2b_wholesale_1",
        "checklist_b2b_wholesale_2",
        "checklist_b2b_wholesale_3",
        "checklist_b2b_wholesale_4",
      ];
    case "pet_supply":
      return [
        "checklist_pet_supply_1",
        "checklist_pet_supply_2",
        "checklist_pet_supply_3",
        "checklist_pet_supply_4",
      ];
    case "building_materials":
      return [
        "checklist_building_materials_1",
        "checklist_building_materials_2",
        "checklist_building_materials_3",
        "checklist_building_materials_4",
      ];
    case "restaurant":
      return [
        "checklist_restaurant_1",
        "checklist_restaurant_2",
        "checklist_restaurant_3",
        "checklist_restaurant_4",
      ];
    case "gifts_seasonal":
      return [
        "checklist_gifts_seasonal_1",
        "checklist_gifts_seasonal_2",
        "checklist_gifts_seasonal_3",
        "checklist_gifts_seasonal_4",
      ];
    default:
      return [
        "checklist_default_1",
        "checklist_default_2",
        "checklist_default_3",
      ];
  }
}
