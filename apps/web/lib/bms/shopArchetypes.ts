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
      return "food";
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
    value === "home_kitchen";
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
    default:
      return { salesMotion: "catalog_guided", discovery: "ค้น catalog ก่อนและถามข้อมูลที่ขาดทีละ 1 ข้อ", basket: "เสนอทางเลือกหรือสินค้าที่เกี่ยวข้องจาก catalog เท่านั้น", repeatPurchase: "ใช้ reorder/restock ตามเจตนาที่ลูกค้ายืนยัน", fulfillment: "ใช้เฉพาะ payment/shipping policy ที่ร้านตั้งค่าไว้" };
  }
}

export function onboardingChecklistForArchetype(value: string | null | undefined): string[] {
  switch (value) {
    case "mini_mart":
      return [
        "เพิ่มหมวดสินค้าหมุนเร็ว เช่น เครื่องดื่ม ของใช้ และของแห้ง",
        "ทดสอบคำถามซื้อซ้ำและการใช้คูปองจากแชตลูกค้า",
        "ตั้งค่าบัญชีรับเงินและค่าส่งให้ครบก่อนเปิด AI ขายจริง",
        "เปิดใช้ restock subscriptions เพื่อเก็บลูกค้าที่ถามของแล้วของหมด",
      ];
    case "fashion":
      return [
        "กำหนด variant ให้ครบ เช่น size / color แล้วเช็กสต๊อกแต่ละตัวเลือก",
        "อัปโหลดรูปหน้าปกและรูปเสริมเพื่อช่วย AI แนะนำสินค้าได้แม่นขึ้น",
        "ทดสอบ flow ของหมด -> เสนอไซซ์หรือรุ่นใกล้เคียง",
        "เปิดใช้ restock subscriptions สำหรับไซซ์ยอดนิยมที่หมดบ่อย",
      ];
    case "home_kitchen":
      return [
        "จัดหมวดสินค้าและคำอธิบายให้ลูกค้าเทียบขนาด/วัสดุได้ง่าย",
        "ทดสอบคำถามแนวเปรียบเทียบสินค้าและการขายแบบเซ็ต",
        "ตั้งค่านโยบายจัดส่ง/กันแตกให้ชัดเพื่อให้ AI ตอบเหมือนร้านจริง",
        "ใช้ restock subscriptions กับสินค้าที่ลูกค้ารอของเข้าได้",
      ];
    case "beauty_personal_care":
      return [
        "จัดหมวดตาม routine หรือปัญหาผิวเพื่อช่วยการแนะนำสินค้า",
        "ทดสอบคำถามแนว consultative เช่น ขอคำแนะนำตามปัญหา",
        "ตั้งค่าโปรโมชั่น/คูปองสำหรับลูกค้าซื้อซ้ำ",
        "ใช้ restock subscriptions กับสินค้าที่ลูกค้าตามหาเป็นประจำ",
      ];
    case "food_beverage":
      return [
        "จัดเมนู/สินค้าให้ AI อ่านชื่อและตัวเลือกได้ง่ายจากแคตตาล็อก",
        "ทดสอบการสั่งหลายรายการในข้อความเดียวและการแก้จำนวนกลางทาง",
        "ตั้งค่าช่องทางชำระเงินและเวลาจัดส่งให้ชัดเพื่อปิดออเดอร์เร็ว",
        "ใช้ archetype นี้เพื่อ demo บริบทการสั่งแชต ไม่ได้เพิ่ม POS เฉพาะทาง",
      ];
    case "gadgets_accessories":
      return [
        "ใส่ชื่อรุ่นที่รองรับและ keywords ให้ครบเพื่อช่วยตอบเรื่อง compatibility",
        "ทดสอบ flow ของหมด -> เสนอรุ่นทดแทนหรือ bundle ที่ใกล้เคียง",
        "เพิ่มชุด upsell เช่น เคส + ฟิล์ม + หัวชาร์จ",
        "เปิดใช้ restock subscriptions กับรุ่นยอดนิยมที่ของหมดเร็ว",
      ];
    case "b2b_wholesale":
      return [
        "ทดสอบออเดอร์จำนวนมากและการซื้อซ้ำจากลูกค้าเดิม",
        "เช็กใบเสนอราคา/ใบแจ้งหนี้จากข้อมูลร้านให้ครบก่อน demo จริง",
        "เพิ่มพนักงานและสิทธิ์เพื่อจำลอง flow ระหว่างฝ่ายขายกับคลัง",
        "ใช้ dashboard/reports ดูสินค้าที่ควรวางแผนเติมเพิ่ม",
      ];
    case "gifts_seasonal":
      return [
        "เตรียมสินค้าเป็นเซ็ต/occasion เพื่อให้ AI ช่วยแนะนำตามงบหรือเทศกาล",
        "ทดสอบคูปองและแคมเปญที่ใช้ช่วงพีค",
        "เพิ่มภาพสินค้าและคำอธิบายที่เน้นการเลือกของขวัญ",
        "ดูยอดสินค้าขายดีรายช่วงเพื่อวางแผน stock ก่อนเทศกาล",
      ];
    default:
      return [
        "กรอกข้อมูลร้าน บัญชีรับเงิน และค่าส่งให้ครบก่อนเปิด AI ขายจริง",
        "เพิ่มสินค้าและสต๊อกอย่างน้อยบางส่วนเพื่อให้ AI เช็กของได้จากข้อมูลจริง",
        "ทดสอบ create order, payment, shipping และ reorder อย่างน้อยหนึ่งรอบ",
      ];
  }
}
