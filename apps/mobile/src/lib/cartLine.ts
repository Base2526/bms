/**
 * ตัวตัดสินว่า "สองบรรทัดในตะกร้าเป็นบรรทัดเดียวกันไหม" และ "บรรทัดนี้คือรุ่นไหนของสินค้า"
 *
 * ⚠️ ไฟล์นี้ตั้งใจไม่ import อะไรเลย (แบบ checkoutMath/paymentMath) — กติกาของตะกร้าต้องเทสได้
 * โดยไม่ต้องมี React/Apollo และต้องมี **ชุดเดียว** ทั้งแอป: ถ้าจอไหนคิดคีย์เอง วันหนึ่งจอนั้นจะ
 * ยุบสองรุ่นเป็นบรรทัดเดียว (เก็บเงินผิดรุ่น) หรือแยกบรรทัดที่ควรรวม (ตะกร้ารกจนแคชเชียร์อ่านไม่ทัน)
 */

/** ค่าที่ server ใช้แทน "ไม่มีไซซ์" — เอาไปโชว์ให้คนหน้าเคาน์เตอร์อ่านไม่ได้ความหมายอะไร */
const PLACEHOLDER_SIZES = new Set(['', '-', 'base', 'default', 'none']);

export interface CartLineIdentity {
  sku: string;
  size?: string | null;
  packCode?: string | null;
  modifierCodes?: readonly string[] | null;
}

/**
 * คีย์ของบรรทัด = ทุกอย่างที่ทำให้ "ราคาหรือของที่ลูกค้าได้รับ" ต่างกัน
 * ⚠️ ตัวเลือก (modifier) อยู่ในคีย์ด้วยโดยตั้งใจ — ชาเย็นหวานน้อยกับชาเย็นหวานปกติเป็นคนละแก้ว
 * และมี price_delta ของตัวเอง การยุบรวมทำให้บรรทัดที่เหลือถือตัวเลือกของคนที่สั่งก่อนไปทั้งคู่
 * · เรียงรหัสก่อนต่อสตริง เพราะลำดับที่แคชเชียร์แตะไม่ใช่ข้อมูล
 */
export function cartLineKey(identity: CartLineIdentity): string {
  const modifiers = [...(identity.modifierCodes ?? [])]
    .map(code => code.trim())
    .filter(Boolean)
    .sort()
    .join('+');
  return [
    identity.sku,
    identity.size ?? '',
    identity.packCode ?? '',
    modifiers,
  ].join(':');
}

export interface CartLineVariantParts {
  size?: string | null;
  unitName?: string | null;
  modifierNames?: readonly string[] | null;
}

/**
 * บรรทัดที่เขียนแต่ชื่อสินค้าเหมือนกันสามบรรทัดคือบรรทัดที่อ่านแล้วตอบไม่ได้ว่ากดผิดหรือเปล่า
 * คืน '' เมื่อไม่มีอะไรจะแยก (สินค้าไซซ์เดียว ไม่มีหน่วยขาย ไม่มีตัวเลือก) — ป้ายว่าง ๆ ที่เขียน
 * "ขนาด BASE" แย่กว่าไม่มีป้าย เพราะมันดูเหมือนข้อมูลแต่ไม่ได้บอกอะไร
 */
export function cartLineVariantLabel(parts: CartLineVariantParts): string {
  const chunks: string[] = [];
  const size = (parts.size ?? '').trim();
  if (size && !PLACEHOLDER_SIZES.has(size.toLowerCase())) {
    chunks.push(`ขนาด ${size}`);
  }
  const unitName = (parts.unitName ?? '').trim();
  if (unitName && unitName.toLowerCase() !== size.toLowerCase()) {
    chunks.push(unitName);
  }
  for (const name of parts.modifierNames ?? []) {
    const trimmed = name.trim();
    if (trimmed) chunks.push(trimmed);
  }
  return chunks.join(' · ');
}
