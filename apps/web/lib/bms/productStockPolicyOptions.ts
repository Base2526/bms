// apps/web/lib/bms/productStockPolicyOptions.ts
// =============================================================
// "รูปแบบสต็อกไหนเลือกได้" — ความจริงชุดเดียวของทั้งฟอร์มสินค้าและหน้า Stock models
// -------------------------------------------------------------
// ไฟล์นี้ตั้งใจไม่ import อะไรเลย (กฎเดียวกับ loyaltyMath.ts) เพื่อให้เทสอ่านได้โดย
// ไม่ต้องมี DB และให้ทั้งสองหน้าอ่านลิสต์เดียวกัน
//
// ⚠️ กฎที่ห้ามพัง: **ทุกค่าในดรอปดาวน์ต้องมีทางตั้งค่าต่อจนเปิดขายได้จริง**
// ก่อนหน้านี้ดรอปดาวน์ยื่นครบ 7 ค่าโดยไม่ดูอะไรเลย แต่ 2 ค่าเป็นทางตันถาวร:
//   · SERIALIZED ต้องการ `bms_products.serial_tracked` ซึ่ง **ไม่มีที่ไหนในแอปตั้งได้**
//     (ผู้เขียนคอลัมน์นี้ตัวเดียวคือปุ่มทำสำเนาสินค้า)
//   · BUNDLE ต้องการ `is_bundle` + แถวใน `bms_product_bundle_items` ซึ่งไม่มีทั้งคู่
// ทั้งสองข้อถูกปิดแล้ว (serial derive จากนโยบาย · มีหน้าแก้ส่วนประกอบของชุด) และ
// `scripts/product-policy-reachability-contract.test.mts` บังคับไว้ว่าต้องเป็นแบบนั้นต่อไป
// =============================================================

export const PRODUCT_STOCK_POLICIES = [
  "DIRECT", "PACK", "BUNDLE", "WEIGHTED", "RECIPE", "SERIALIZED", "NON_STOCK",
] as const;

export type ProductStockPolicyCode = typeof PRODUCT_STOCK_POLICIES[number];

/**
 * รูปแบบที่ต้องเปิดความสามารถของร้านก่อนจึงจะเปิดขายได้ (readiness บล็อกไว้)
 *
 * มีเฉพาะสองตัวที่ `getProductReadinessInTx()` ตรวจ capability จริง — ที่เหลือ
 * ตั้งค่าต่อได้ด้วยตัวเองในแอป จึงยื่นให้เลือกได้เสมอ:
 *   · PACK       → เพิ่มหน่วยขายที่ /admin/product-packs
 *   · BUNDLE     → เพิ่มส่วนประกอบที่ /admin/stock-models
 *   · SERIALIZED → ธง serial_tracked ถูกตั้งให้เองจากนโยบาย
 *   · NON_STOCK  → ไม่มีเงื่อนไขเลย (และ server ไม่เคยตรวจ capability ให้มัน)
 */
export const POLICY_REQUIRED_CAPABILITY: Partial<Record<ProductStockPolicyCode, string>> = {
  WEIGHTED: "WEIGHTED_PRODUCT",
  RECIPE: "RECIPE",
};

/** รูปแบบที่ต้องไปตั้งค่าต่อที่หน้าอื่นก่อนจะเปิดขายได้ — ใช้เขียนคำใบ้ใต้ดรอปดาวน์ */
export const POLICY_FOLLOW_UP_PATH: Partial<Record<ProductStockPolicyCode, string>> = {
  PACK: "/admin/product-packs",
  BUNDLE: "/admin/stock-models",
  RECIPE: "/admin/stock-models",
  WEIGHTED: "/admin/stock-models",
};

export function productStockPolicyOptions(
  capabilityIsActive: (capability: string) => boolean,
  keepValue?: string | null
): ProductStockPolicyCode[] {
  return PRODUCT_STOCK_POLICIES.filter((policy) => {
    if (keepValue && policy === keepValue) return true;
    const required = POLICY_REQUIRED_CAPABILITY[policy];
    return !required || capabilityIsActive(required);
  });
}
