// =============================================================
// BMS — บาร์โค้ดสินค้า: ตรวจและสร้างเลขภายในร้าน
// -------------------------------------------------------------
// ไฟล์นี้ตั้งใจไม่ import อะไรเลย (เหมือน loyaltyMath.ts) เพื่อให้เทสได้โดยไม่ต้องมี
// DB และให้ทั้งฝั่งจอกับฝั่ง server ใช้ตัวเดียวกัน — ถ้าสองฝั่งคิด check digit
// ต่างกัน จอจะบอกว่าเลขถูกแต่ server ปฏิเสธ (หรือแย่กว่า: ยอมรับเลขที่ยิงไม่ติด)
//
// สิ่งที่ต้องรู้ก่อนแก้ไฟล์นี้
// ---------------------------------------------------------------
// 1. บาร์โค้ดบนของที่โรงงานติดมาแล้ว = ของ GS1 ห้ามสร้างใหม่ทับ ต้องยิงเข้ามา
//    ฟังก์ชัน generate ในไฟล์นี้มีไว้สำหรับ "ของที่ไม่มีบาร์โค้ด" เท่านั้น
//    (ของแบ่งขาย แบ่งแพ็กเอง ของทำเอง) แล้วร้านพิมพ์สติกเกอร์แปะเอง
//
// 2. เลขที่สร้างต้องขึ้นต้นด้วย 20–29 ซึ่ง GS1 กันไว้ให้ร้านใช้ภายใน (in-store /
//    restricted distribution) การันตีว่าไม่ชนกับสินค้าแบรนด์ไหนในโลก
//    ถ้าสุ่มเลขขึ้นต้น 885x (prefix ของไทย) คือไปทับเลขที่ GS1 ออกให้บริษัทอื่นจริง ๆ
//    แล้ววันหนึ่งสินค้านั้นเข้าร้าน จะยิงไปโดนของเราแทน
// =============================================================

/** ช่วง in-store ของ GS1 · ใช้ 20 เป็นค่าเริ่มต้น เหลือ 21–29 ไว้ให้ร้านที่ต้องแยกกลุ่ม */
export const IN_STORE_PREFIX = "20";

/**
 * check digit ของ EAN/UPC (modulo-10) — ใช้กับ EAN-13, EAN-8 และ UPC-A
 *
 * น้ำหนักสลับ 3/1 ไล่จากขวาไปซ้าย (ไม่ใช่ซ้ายไปขวา — สลับแล้วจะได้เลขผิดสำหรับ
 * ความยาวคู่ เช่น EAN-8) `digits` คือตัวเลขทั้งหมด "ยังไม่รวม" check digit
 */
export function eanCheckDigit(digits: string): number {
  let sum = 0;
  const chars = digits.split("").reverse();
  for (let i = 0; i < chars.length; i += 1) {
    const n = Number(chars[i]);
    sum += i % 2 === 0 ? n * 3 : n;
  }
  return (10 - (sum % 10)) % 10;
}

export type BarcodeCheck =
  | { kind: "EMPTY" }
  /** ความยาวมาตรฐาน + check digit ถูก — พิมพ์เป็นบาร์โค้ดจริงได้ */
  | { kind: "VALID"; symbology: "EAN-8" | "UPC-A" | "EAN-13" }
  /** ความยาวมาตรฐานแต่ check digit ผิด — เกือบแน่นอนว่าพิมพ์ตกหรือสลับเลข */
  | { kind: "BAD_CHECK_DIGIT"; symbology: "EAN-8" | "UPC-A" | "EAN-13"; expected: number }
  /** ไม่ใช่ความยาวมาตรฐาน — ใช้ในระบบได้ (ค้นเจอ/ยิงเจอ) แต่พิมพ์เป็น EAN ไม่ได้ */
  | { kind: "NON_STANDARD"; reason: string };

/**
 * ตรวจบาร์โค้ดที่พนักงานกรอก/ยิงเข้ามา
 *
 * เจตนา: **เตือน ไม่บล็อก** · ร้านจริงมีบาร์โค้ดแปลก ๆ จากซัพพลายเออร์ (Code 128
 * ความยาวอิสระ, รหัสภายในของโรงงาน, เลขที่ร้านเคยเขียนเอง) ถ้าบล็อกทุกอย่างที่ไม่ใช่
 * EAN-13 ร้านจะบันทึกสินค้าที่มีอยู่จริงไม่ได้ · POS ก็ค้นแบบเทียบตรงอยู่แล้ว
 * จึงยิงเจอไม่ว่าเลขจะเป็นรูปแบบไหน
 */
export function checkBarcode(raw: string): BarcodeCheck {
  const code = raw.trim();
  if (!code) return { kind: "EMPTY" };
  if (!/^\d+$/.test(code)) {
    return { kind: "NON_STANDARD", reason: "มีตัวอักษรที่ไม่ใช่ตัวเลข — พิมพ์เป็น EAN/UPC ไม่ได้" };
  }

  const symbology =
    code.length === 8 ? "EAN-8" as const
    : code.length === 12 ? "UPC-A" as const
    : code.length === 13 ? "EAN-13" as const
    : null;
  if (!symbology) {
    return { kind: "NON_STANDARD", reason: `ยาว ${code.length} หลัก (EAN-13 ใช้ 13 · UPC-A 12 · EAN-8 8)` };
  }

  const expected = eanCheckDigit(code.slice(0, -1));
  if (expected !== Number(code.slice(-1))) return { kind: "BAD_CHECK_DIGIT", symbology, expected };
  return { kind: "VALID", symbology };
}

/**
 * สร้าง EAN-13 ช่วงร้านใช้ภายในจาก "ลำดับที่" ของร้าน
 *
 * โครงสร้าง: 20 + ลำดับ 10 หลัก + check digit
 * ใช้ลำดับที่วิ่งขึ้น ไม่ใช่เลขสุ่ม เพราะเลขสุ่มต้องวนตรวจการชนซ้ำ ๆ และเมื่อร้าน
 * มีสินค้ามากขึ้น การชนจะบ่อยขึ้นเรื่อย ๆ อย่างเงียบ ๆ · ผู้เรียกยังต้องตรวจการชน
 * อีกชั้นอยู่ดี (ร้านอาจเคยกรอกเลขช่วงนี้ไว้เองมาก่อน) แต่เริ่มจากลำดับทำให้
 * แทบไม่ต้องลองซ้ำ
 */
export function inStoreBarcode(sequence: number, prefix: string = IN_STORE_PREFIX): string {
  if (!Number.isInteger(sequence) || sequence < 0) throw new Error("ลำดับต้องเป็นจำนวนเต็มไม่ติดลบ");
  if (!/^2\d$/.test(prefix)) throw new Error("prefix ต้องอยู่ในช่วง 20–29 (ช่วงที่ GS1 กันไว้ให้ร้านใช้ภายใน)");
  const body = String(sequence).padStart(10, "0");
  if (body.length > 10) throw new Error("ลำดับเกินช่วงที่ EAN-13 รองรับ");
  const head = `${prefix}${body}`;
  return `${head}${eanCheckDigit(head)}`;
}

/** true = เลขนี้เป็นเลขที่ร้านสร้างเอง ไม่ใช่ของ GS1 (ใช้บอกผู้ใช้ว่าอันไหนต้องพิมพ์สติกเกอร์) */
export function isInStoreBarcode(code: string): boolean {
  const c = code.trim();
  return /^2\d{12}$/.test(c) && checkBarcode(c).kind === "VALID";
}
