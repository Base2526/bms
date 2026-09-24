// =============================================================
// เลขคณิตของรายงานภาษี — pure (ไม่ import อะไรเลย เทสได้โดยไม่มี DB)
// -------------------------------------------------------------
// ความหมายของคอลัมน์ใน bms_tax_documents (7.88):
//   taxable_amount = ยอดที่ต้องเสียภาษี **รวม VAT แล้ว**
//   exempt_amount  = ยอดขายที่ได้รับยกเว้น (ไม่มี VAT)
//   vat_amount     = ภาษีมูลค่าเพิ่ม
//   rounding_amount= ปัดเศษเงินสด — ไม่ใช่ฐานภาษี (7.95)
//   grand_total    = taxable + exempt + rounding
//
// รายงานภาษีต้องการ "มูลค่าก่อนภาษี" = taxable − vat · ถ้าเอา taxable ไปใส่ช่องมูลค่า
// ตรง ๆ ยอดขายจะสูงเกินจริงเท่า VAT และรวมกับช่องภาษีแล้วนับ VAT ซ้ำสองรอบ
//
// ใบลดหนี้เก็บยอดเป็นบวก (ประเภทเอกสารบอกเองว่าเป็นการลด) → รายงานต้องกลับเครื่องหมาย
// =============================================================

export type TaxDocKind = "ABBREVIATED" | "FULL" | "CREDIT_NOTE";

export type TaxAmounts = {
  /** มูลค่าสินค้า/บริการที่ต้องเสียภาษี ก่อน VAT */
  base: number;
  /** ยอดขายที่ได้รับยกเว้น */
  exempt: number;
  vat: number;
  /** base + exempt + vat — ไม่รวมปัดเศษเงินสด */
  total: number;
  /** ปัดเศษเงินสด แยกไว้ให้กระทบยอดกับเงินที่รับได้ */
  rounding: number;
};

export const ZERO_TAX_AMOUNTS: TaxAmounts = Object.freeze({ base: 0, exempt: 0, vat: 0, total: 0, rounding: 0 });

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** แปลงแถวเอกสารหนึ่งใบเป็นยอดในรายงาน (ใบลดหนี้เป็นลบ) */
export function taxAmountsOf(doc: {
  docType: TaxDocKind;
  taxableAmount: number;
  exemptAmount: number;
  vatAmount: number;
  roundingAmount: number;
}): TaxAmounts {
  const sign = doc.docType === "CREDIT_NOTE" ? -1 : 1;
  const base = round2(Number(doc.taxableAmount) - Number(doc.vatAmount));
  const exempt = round2(Number(doc.exemptAmount));
  const vat = round2(Number(doc.vatAmount));
  return {
    base: round2(sign * base),
    exempt: round2(sign * exempt),
    vat: round2(sign * vat),
    total: round2(sign * (base + exempt + vat)),
    rounding: round2(sign * Number(doc.roundingAmount || 0)),
  };
}

export function addTaxAmounts(a: TaxAmounts, b: TaxAmounts): TaxAmounts {
  return {
    base: round2(a.base + b.base),
    exempt: round2(a.exempt + b.exempt),
    vat: round2(a.vat + b.vat),
    total: round2(a.total + b.total),
    rounding: round2(a.rounding + b.rounding),
  };
}

export function sumTaxAmounts(list: TaxAmounts[]): TaxAmounts {
  return list.reduce(addTaxAmounts, ZERO_TAX_AMOUNTS);
}

/** YYYY-MM-DD → DD/MM/YYYY ตามปีปฏิทินที่ร้านตั้ง (พ.ศ. เป็นค่าปริยายของใบกำกับไทย) */
export function formatTaxDate(isoDate: string, era: "BE" | "CE"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return isoDate;
  const year = Number(m[1]) + (era === "BE" ? 543 : 0);
  return `${m[3]}/${m[2]}/${year}`;
}

/** ตรวจช่วงวันที่ของรายงาน — ต้องเป็น YYYY-MM-DD, from <= to, ไม่เกิน 400 วัน */
export function isIsoCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function assertTaxPeriod(from: string, to: string): { from: string; to: string } {
  if (!isIsoCalendarDate(from) || !isIsoCalendarDate(to)) {
    throw new Error("ช่วงวันที่ต้องเป็นวันที่จริงในรูปแบบ YYYY-MM-DD");
  }
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error("วันที่ไม่ถูกต้อง");
  if (a > b) throw new Error("วันเริ่มต้องไม่อยู่หลังวันสิ้นสุด");
  if ((b - a) / 86_400_000 > 400) throw new Error("ช่วงรายงานภาษียาวได้ไม่เกิน 400 วัน");
  return { from, to };
}

/** เดือนภาษีของวันที่ (YYYY-MM) — ใช้จับใบเต็มที่ออกแทนใบย่อข้ามเดือน */
export function taxMonthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}
