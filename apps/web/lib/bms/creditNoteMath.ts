// =============================================================
// ใบลดหนี้เต็มรูป — ตัวเลขที่ต้องพิมพ์ตามมาตรา 86/10
// -------------------------------------------------------------
// pure โดยตั้งใจ (ไม่ import อะไร) เทสได้โดยไม่ต้องมีฐานข้อมูล
//
// มาตรา 86/10 ให้ใบลดหนี้แสดง: มูลค่าตามใบกำกับเดิม · มูลค่าที่ถูกต้อง · ผลต่าง ·
// VAT ของผลต่าง · เหตุผลสั้น ๆ · เลขที่/วันที่ของใบกำกับเดิม
//
// บิลหนึ่งใบคืนของได้หลายครั้ง แต่ละครั้งได้ใบลดหนี้ของตัวเอง ดังนั้น "มูลค่าที่ถูกต้อง"
// ของใบนี้ต้องหักใบลดหนี้ที่ออกไปก่อนหน้าด้วย ไม่งั้นใบที่สองบอกว่ามูลค่าที่ถูกต้อง
// สูงกว่าความจริงเท่ายอดคืนครั้งแรก
// =============================================================

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * `issueCreditNote` เก็บเหตุผลเป็น `<เหตุผล> [<posReturnId>]` เมื่อมาจากการคืนที่เครื่องขาย
 * แยกเหตุผลที่คนอ่านออกจากรหัสอ้างอิงภายใน — รหัส uuid ไม่ควรไปโผล่บนเอกสารของลูกค้า
 */
export function parseCreditReason(raw: string | null | undefined): { reason: string; returnRef: string | null } {
  const text = String(raw ?? "").trim();
  const m = /^(.*?)\s*\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]$/i.exec(text);
  if (!m) return { reason: text, returnRef: null };
  return { reason: m[1].trim(), returnRef: m[2].toLowerCase() };
}

export type CreditNoteFigures = {
  /** มูลค่าตามใบกำกับภาษีเดิม (รวม VAT) */
  originalValue: number;
  /** ลดหนี้ไปแล้วก่อนใบนี้ (รวม VAT) */
  previouslyCredited: number;
  /** มูลค่าที่ถูกต้องหลังใบนี้ (รวม VAT) */
  correctValue: number;
  /** ผลต่าง = ยอดของใบนี้ (รวม VAT) */
  difference: number;
  /** มูลค่าของผลต่างก่อน VAT (ส่วนที่เสีย VAT + ส่วนที่ยกเว้น) */
  differenceBeforeVat: number;
  /** VAT ของผลต่าง */
  differenceVat: number;
};

/**
 * `taxable` ของใบลดหนี้เป็นยอด "รวม VAT" ของส่วนที่เสีย VAT (ดู issueCreditNote)
 * ผลต่างก่อน VAT จึงเป็น taxable − vat + exempt
 */
export function creditNoteFigures(input: {
  originalTotal: number;
  previouslyCredited: number;
  amount: number;
  taxableAmount: number;
  exemptAmount: number;
  vatAmount: number;
}): CreditNoteFigures {
  const originalValue = round2(Number(input.originalTotal) || 0);
  const previouslyCredited = round2(Math.max(0, Number(input.previouslyCredited) || 0));
  const difference = round2(Number(input.amount) || 0);
  const differenceVat = round2(Number(input.vatAmount) || 0);
  return {
    originalValue,
    previouslyCredited,
    correctValue: round2(originalValue - previouslyCredited - difference),
    difference,
    differenceBeforeVat: round2(
      (Number(input.taxableAmount) || 0) - differenceVat + (Number(input.exemptAmount) || 0)
    ),
    differenceVat,
  };
}
