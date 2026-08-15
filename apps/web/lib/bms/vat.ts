// =============================================================
// BMS VAT — คำนวณภาษีมูลค่าเพิ่ม + แปลงจำนวนเงินเป็นตัวอักษรไทย (7.88)
// -------------------------------------------------------------
// วิธีปัดเศษไม่มีกฎเดียวที่ใช้ได้กับทุกร้าน — ตรวจกับเลขบนใบจริงแล้วต่างกัน:
//
//   วราภรณ์  หาฐานก่อน:  134.00 ÷ 1.07  = 125.2336 → 125.23
//                        VAT = 134.00 − 125.23     = 8.77
//   Makro    หา VAT ก่อน: 354.00 × 7/107 = 23.1588 → 23.15 (ตัดทิ้ง)
//                        ฐาน = 354.00 − 23.15      = 330.85
//
// ถ้าใช้วิธีของวราภรณ์กับใบ Makro จะได้ VAT 23.16 ต่างไป 1 สตางค์ ซึ่งบน
// ใบกำกับภาษีถือว่าผิด → เป็นค่าตั้งต่อร้าน (bms_store_profile.vat_rounding, 7.89)
// เลือกครั้งเดียวแล้วห้ามเปลี่ยนหลังออกใบกำกับใบแรก
//
// ที่เหมือนกันทั้งสองเจ้า: คิดเป็น "กลุ่ม" (V รวมกันทีเดียว) ไม่ใช่ปัดทีละบรรทัด
// แล้วบวกกัน — ปัดทีละบรรทัดจะไม่ตรงกับยอดที่พิมพ์บนใบ
// =============================================================

export type VatCategory = "V" | "N" | "UNKNOWN";

export type VatLine = {
  /** ยอดรวมของบรรทัดนี้ (ราคา × จำนวน) หลังส่วนลดระดับบรรทัดแล้ว */
  amount: number;
  vatCategory: VatCategory;
};

export type VatBreakdown = {
  /** ยอดกลุ่มเสียภาษี — "รวม VAT แล้ว" เสมอ ไม่ว่าร้านจะตั้งราคาแบบไหน */
  taxableAmount: number;
  /** ยอดกลุ่มยกเว้น */
  exemptAmount: number;
  vatAmount: number;
  /** ฐานก่อน VAT ของทั้งบิล = taxable − vat + exempt */
  netBeforeVat: number;
  /** ยอดที่ลูกค้าจ่าย = taxable + exempt + rounding */
  grandTotal: number;
  roundingAmount: number;
  vatRate: number;
};

/**
 * BASE_FIRST         ปัดฐานก่อนแล้วลบหา VAT (แบบวราภรณ์) — ค่าเริ่มต้น
 * VAT_FIRST_TRUNCATE ตัดเศษ VAT ทิ้งแล้วลบหาฐาน (แบบ Makro)
 * VAT_FIRST_ROUND    ปัด VAT ตามปกติแล้วลบหาฐาน
 */
export type VatRounding = "BASE_FIRST" | "VAT_FIRST_TRUNCATE" | "VAT_FIRST_ROUND";

export type VatSettings = {
  vatRegistered: boolean;
  /** true = ราคาสินค้ารวม VAT แล้ว (วราภรณ์/Makro) · false = ยังไม่รวม (KFC) */
  priceIncludesVat: boolean;
  vatRate: number;
  vatRounding?: VatRounding;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function trunc2(n: number): number {
  return Math.floor((n + Number.EPSILON) * 100) / 100;
}

/**
 * แยก "ยอดรวม VAT" ออกเป็น ฐาน + VAT ตามวิธีที่ร้านเลือก
 * ตัวไหนถูกปัดก่อน อีกตัวได้จากการลบเสมอ — ยอดรวมจึงตรงเป๊ะทุกวิธี
 */
function splitGross(gross: number, rate: number, mode: VatRounding): { base: number; vat: number } {
  if (rate <= 0) return { base: round2(gross), vat: 0 };
  if (mode === "VAT_FIRST_TRUNCATE") {
    const vat = trunc2((gross * rate) / (100 + rate));
    return { base: round2(gross - vat), vat };
  }
  if (mode === "VAT_FIRST_ROUND") {
    const vat = round2((gross * rate) / (100 + rate));
    return { base: round2(gross - vat), vat };
  }
  const base = round2(gross / (1 + rate / 100));
  return { base, vat: round2(gross - base) };
}

/**
 * คิด VAT ของทั้งบิล
 *
 * ร้านที่ไม่ได้จด VAT → ยอดทั้งหมดไปกองยกเว้น ไม่มี VAT
 * สินค้าที่ยังไม่ระบุประเภท (UNKNOWN) → นับเป็นเสียภาษี เพราะการเดาว่ายกเว้น
 * แล้วเดาผิดคือการเก็บภาษีขาด ส่วนเดาว่าเสียแล้วผิดคือเก็บเกินซึ่งแก้ได้
 * (ทางที่ถูกคือบังคับระบุก่อนออกใบกำกับ — ดู assertVatCategoriesResolved)
 */
export function computeVat(
  lines: VatLine[],
  settings: VatSettings,
  opts: { roundingAmount?: number } = {}
): VatBreakdown {
  const rate = settings.vatRegistered ? Number(settings.vatRate) : 0;
  const rounding = round2(opts.roundingAmount ?? 0);

  let taxableGross = 0;
  let exempt = 0;
  for (const ln of lines) {
    const amount = Number(ln.amount) || 0;
    if (!settings.vatRegistered || ln.vatCategory === "N") exempt += amount;
    else taxableGross += amount;
  }

  // ราคายังไม่รวม VAT → บวกเข้าไปก่อน แล้วจากนั้นคิดแบบเดียวกันทั้งสองแบบ
  if (settings.vatRegistered && !settings.priceIncludesVat) {
    taxableGross = round2(taxableGross * (1 + rate / 100));
  }
  taxableGross = round2(taxableGross);
  exempt = round2(exempt);

  const split = splitGross(taxableGross, rate, settings.vatRounding ?? "BASE_FIRST");
  const vatAmount = split.vat;
  const netBeforeVat = round2(split.base + exempt);
  const grandTotal = round2(taxableGross + exempt + rounding);

  return {
    taxableAmount: taxableGross,
    exemptAmount: exempt,
    vatAmount,
    netBeforeVat,
    grandTotal,
    roundingAmount: rounding,
    vatRate: rate,
  };
}

/**
 * ออกใบกำกับไม่ได้ถ้ายังมีสินค้าที่ไม่รู้ว่าเสีย VAT หรือไม่
 * คืนรายการ SKU ที่ต้องไปกำหนดก่อน (ว่าง = พร้อมออกใบ)
 */
export function unresolvedVatSkus(lines: Array<{ sku: string; vatCategory: VatCategory }>): string[] {
  return [...new Set(lines.filter((l) => l.vatCategory === "UNKNOWN").map((l) => l.sku))];
}

// ---------------------------------------------------------------
// จำนวนเงินเป็นตัวอักษรไทย
// ---------------------------------------------------------------

const THAI_DIGITS = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const THAI_PLACES = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน", "ล้าน"];

/** อ่านจำนวนเต็มไม่เกิน 7 หลัก (ใช้ซ้ำสำหรับหลักล้านขึ้นไป) */
function readGroup(n: number): string {
  if (n === 0) return "";
  let out = "";
  const digits = String(n).split("").map(Number);
  const len = digits.length;
  for (let i = 0; i < len; i++) {
    const d = digits[i];
    const place = len - i - 1;
    if (d === 0) continue;
    if (place === 1 && d === 1) out += "สิบ";
    else if (place === 1 && d === 2) out += "ยี่สิบ";
    else if (place === 0 && d === 1 && len > 1) out += "เอ็ด";
    else out += THAI_DIGITS[d] + THAI_PLACES[place];
  }
  return out;
}

function readInteger(n: number): string {
  if (n === 0) return "ศูนย์";
  if (n >= 1_000_000) {
    const millions = Math.floor(n / 1_000_000);
    const rest = n % 1_000_000;
    return readInteger(millions) + "ล้าน" + (rest > 0 ? readGroup(rest) : "");
  }
  return readGroup(n);
}

/**
 * "หนึ่งร้อยสามสิบสี่บาทถ้วน" — ข้อความบังคับบนใบกำกับเต็มรูป
 * ปัดเป็นสตางค์ก่อนเสมอ ไม่งั้นเศษทศนิยมจาก float จะโผล่เป็นสตางค์แปลก ๆ
 */
export function bahtText(amount: number): string {
  const value = Math.abs(Math.round((Number(amount) + Number.EPSILON) * 100));
  const baht = Math.floor(value / 100);
  const satang = value % 100;
  const sign = Number(amount) < 0 ? "ลบ" : "";

  if (satang === 0) return `${sign}${readInteger(baht)}บาทถ้วน`;
  return `${sign}${readInteger(baht)}บาท${readInteger(satang)}สตางค์`;
}

/**
 * วันที่บนเอกสาร — Makro ใช้ พ.ศ. วราภรณ์/KFC ใช้ ค.ศ. เป็นค่าตั้งต่อร้าน
 * รูปแบบ dd/MM/yyyy ตามที่เห็นบนใบจริงทุกใบ
 */
export function formatDocumentDate(date: Date, era: "BE" | "CE"): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = era === "BE" ? date.getFullYear() + 543 : date.getFullYear();
  return `${d}/${m}/${y}`;
}
