// =============================================================
// BMS — ราคาตามจำนวน (8.1)
// -------------------------------------------------------------
// ไฟล์นี้ตั้งใจไม่ import อะไรเลย (เหมือน loyaltyMath.ts / barcode.ts)
//
// เหตุผลเดียวกับ composeDiscounts: จอ POS คิดราคาบรรทัดเพื่อโชว์ยอดให้ลูกค้าเห็น
// ก่อนรับเงิน แล้ว createOrder คิดใหม่อีกครั้งตอน commit · ถ้าสองทางได้เลขต่างกัน
// แม้สตางค์เดียว ยอดที่เครื่องส่งมาจะไม่ตรงกับที่ server คิด → PAYMENT_MISMATCH
// แล้วบิลถูกยกเลิกทิ้งทั้งใบโดยหน้าเคาน์เตอร์ไม่รู้สาเหตุ
//
// จอไม่ได้ "ตัดสิน" ราคา — server ตัดสินเสมอตอน commit · จอแค่พรีวิวด้วยกฎเดียวกัน
// =============================================================

export type PriceTier = {
  /** ซื้อครบกี่หน่วยฐานถึงได้ราคานี้ */
  minQty: number;
  unitPrice: number;
};

/**
 * ราคาต่อหน่วยฐานสำหรับจำนวนที่ซื้อ
 *
 * ขั้นที่ minQty สูงสุดที่ "ไม่เกิน" จำนวนที่ซื้อชนะ · ไม่มีขั้นไหนเข้าเงื่อนไข = ราคาปกติ
 *
 * ไม่บังคับว่าขั้นที่สูงกว่าต้องถูกกว่า และไม่แก้ให้เอง — ร้านที่ตั้งราคาขั้นสูงแพงกว่า
 * ขั้นต่ำอาจตั้งใจจริง (เช่นชาร์จเพิ่มเมื่อซื้อยกลัง เพราะต้องแพ็กพิเศษ) หน้าที่ของ
 * ฟังก์ชันนี้คือทำตามที่ตั้งไว้อย่างคาดเดาได้ ไม่ใช่เดาเจตนา
 */
export function unitPriceForQty(basePrice: number, tiers: PriceTier[], qty: number): number {
  if (!Number.isFinite(qty) || qty <= 0) return basePrice;

  let best: PriceTier | null = null;
  for (const tier of tiers) {
    if (!Number.isFinite(tier.minQty) || tier.minQty < 2) continue;
    if (tier.minQty > qty) continue;
    if (!best || tier.minQty > best.minQty) best = tier;
  }
  return best ? best.unitPrice : basePrice;
}

/**
 * ราคาของทั้งบิล แยกตาม SKU
 *
 * จำนวนที่ใช้ตัดสินขั้นราคาคือ "ยอดรวมของ SKU นั้นทั้งบิล" ไม่ใช่ต่อบรรทัด —
 * ลูกค้าที่หยิบ 60ml 5 ขวด กับ 150ml 5 ขวด ถือว่าซื้อสินค้านั้น 10 ชิ้น ซึ่งตรงกับ
 * สิ่งที่ร้านหมายถึงเวลาพูดว่า "ซื้อครบ 10 ได้ราคาส่ง" · ถ้าคิดต่อบรรทัด ลูกค้าคนนั้น
 * จะไม่ได้ราคาส่งแล้วอธิบายให้เข้าใจไม่ได้
 *
 * บรรทัดที่ขายเป็นหน่วยขาย (pack) ไม่ถูกแตะ — ราคา pack คือการบอกตรง ๆ ว่ากล่องนี้
 * ราคาเท่านี้ ให้สองกลไกแย่งกันตัดสินราคาจะอธิบายบิลไม่ได้ · แต่จำนวนของ pack
 * ยังถูกนับรวมเป็นยอดของ SKU นั้น เพราะลูกค้าก็ซื้อของไปจริงเท่านั้นชิ้น
 */
export function priceLinesByQty<T extends { sku: string; qty: number; packUnitPrice?: number | null }>(
  lines: T[],
  basePriceBySku: Map<string, number>,
  tiersBySku: Map<string, PriceTier[]>
): Array<T & { unitPrice: number; tierApplied: boolean }> {
  const totalBySku = new Map<string, number>();
  for (const line of lines) {
    totalBySku.set(line.sku, (totalBySku.get(line.sku) ?? 0) + Math.max(0, line.qty));
  }

  return lines.map((line) => {
    const basePrice = basePriceBySku.get(line.sku) ?? 0;
    if (line.packUnitPrice != null) {
      return { ...line, unitPrice: basePrice, tierApplied: false };
    }
    const unitPrice = unitPriceForQty(basePrice, tiersBySku.get(line.sku) ?? [], totalBySku.get(line.sku) ?? 0);
    return { ...line, unitPrice, tierApplied: unitPrice !== basePrice };
  });
}
