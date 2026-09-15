// =============================================================
// ยอดของ "หนึ่งบรรทัดในตะกร้า" ที่จอขายโชว์และเอาไปรวมเป็นยอดบิล
// -------------------------------------------------------------
// อยู่แยกจาก page.tsx เพราะเป็นเลขที่คนจ่ายเงินจริง จึงต้องเทสได้โดยไม่ต้องเรนเดอร์จอ
// 9,800 บรรทัด · ไฟล์นี้ตั้งใจไม่ import อะไรเลย (แบบ pricing.ts / cashRounding.ts)
//
// ⚠️ ต้องได้เลขเดียวกับที่ `createOrderInTx()` คิดตอน commit ทุกสตางค์ ไม่งั้น
// `recordPosSale()` ตอบ PAYMENT_MISMATCH แล้วยกเลิกบิลทิ้งทั้งใบต่อหน้าลูกค้า
// =============================================================

export type ChargeableCartLine = {
  /** จำนวน "หน่วยขาย" ในตะกร้า */
  packQty: number;
  /** 1 หน่วยขาย = กี่หน่วยฐาน */
  baseQty: number;
  /** ราคาต่อหน่วยขาย (ไม่รวมตัวเลือก) */
  packPrice: number;
  /** ราคาป้ายต่อหน่วยฐาน (ไม่รวมตัวเลือก) */
  basePrice: number;
  /** ป้ายเครื่องชั่ง — บรรทัดชั่งขายคิดเป็นหน่วยฐานทั้งบรรทัด */
  scaleBarcode?: string | null;
  modifierCodes?: string[];
  modifiers?: Array<{ code: string; name?: string; priceDelta?: number }>;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * ส่วนเพิ่มของตัวเลือกต่อหนึ่งหน่วยขาย
 *
 * ⚠️ `price_delta` **เข้ายอดบิล** — `createOrderInTx()` บวก `priceDelta × จำนวนหน่วยขาย`
 * ท้ายสุดหลังราคาส่ง/โปร · จอเคยไม่บวกเลยเพราะ type ประกาศ `modifiers` ไว้แค่ `{code, name}`
 * พร้อมคอมเมนต์ว่า "มีผลต่อ stock ไม่ใช่ราคา" ซึ่งเลิกจริงตั้งแต่ 9.45
 *
 * ราคามาจากผลการยิงเสมอ ไม่ใช่จากที่จอจำไว้ — server อ่านราคาจากฐานใหม่ตอน commit อยู่แล้ว
 * ค่านี้มีไว้ให้พรีวิวตรงกันเท่านั้น
 */
export function modifierUnitPriceOf(line: ChargeableCartLine): number {
  const selected = line.modifierCodes ?? [];
  if (selected.length === 0) return 0;
  return (line.modifiers ?? []).reduce(
    (sum, modifier) => selected.includes(modifier.code)
      ? sum + (Number(modifier.priceDelta) || 0)
      : sum,
    0
  );
}

export type CartLineCharge = {
  /** ราคาป้ายต่อหน่วยที่คิดเงิน ก่อนราคาส่งและก่อนตัวเลือก */
  shelfUnitPrice: number;
  modifierUnitPrice: number;
  /** ก้อนตัวเลือกของบรรทัดนี้ — บรรทัดที่เข้าโปรยังต้องบวกก้อนนี้ */
  modifierAmount: number;
  /** ราคาต่อหน่วยที่คิดเงินจริง (ราคาส่งถ้ามี + ตัวเลือก) */
  unitPrice: number;
  /** จำนวนหน่วยที่คิดเงิน — ของชั่งขายคิดเป็นหน่วยฐาน (กรัม) ไม่ใช่ "1 ป้าย" */
  chargedQty: number;
  amount: number;
};

/**
 * สิ่งที่บรรทัดนี้คิดเงินจริง — ราคาต่อหน่วย × จำนวนหน่วย
 *
 * ของชั่งขาย (9.41) คิดเป็นหน่วยฐาน (กรัม) ไม่ใช่ "1 ป้าย": `packQty` คือจำนวนป้าย
 * ส่วนน้ำหนักอยู่ใน `baseQty` · ยอดรวมบิล บรรทัดคำอธิบาย และยอดท้ายบรรทัด ต้องอ่านกฎ
 * เดียวกันจากที่นี่ ไม่งั้นจอบอกคนละเลขกันเอง (เคยเป็น: ของชั่งที่ติดราคาส่งโชว์ยอด
 * ต่อกรัมท้ายบรรทัด แต่ยอดรวมคิดเต็มน้ำหนัก)
 */
export function cartLineCharge(
  line: ChargeableCartLine,
  tierPrice: number | undefined
): CartLineCharge {
  const shelfUnitPrice = line.scaleBarcode ? line.basePrice : line.packPrice;
  const modifierUnitPrice = modifierUnitPriceOf(line);
  const productUnitPrice = tierPrice ?? shelfUnitPrice;
  const chargedQty = line.scaleBarcode ? line.packQty * line.baseQty : line.packQty;
  // แยกก้อนตัวเลือกออกมาเพราะบรรทัดที่เข้าโปรคิดยอดสินค้าครั้งเดียวต่อ SKU+ไซซ์
  // แต่ตัวเลือกยังบวกทุกบรรทัดตามจำนวนหน่วยขาย — ตรงกับ modifierTotal ของ createOrderInTx
  const modifierAmount = round2(modifierUnitPrice * chargedQty);
  const productAmount = round2(productUnitPrice * chargedQty);
  return {
    shelfUnitPrice,
    modifierUnitPrice,
    modifierAmount,
    unitPrice: productUnitPrice + modifierUnitPrice,
    chargedQty,
    amount: round2(productAmount + modifierAmount),
  };
}
