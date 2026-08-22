// =============================================================
// Code 39 — บาร์โค้ดเลขใบเสร็จท้ายบิล
// -------------------------------------------------------------
// ทำไม Code 39 ไม่ใช่ EAN/Code128:
//   • เข้ารหัสตัวอักษรได้ (เลขเอกสารมี prefix เป็นตัวอักษรได้ เช่น X6908160002)
//   • ความยาวไม่จำกัดตายตัว และไม่ต้องมี check digit
//   • เครื่องสแกนหน้าร้านทุกรุ่นอ่านได้โดยไม่ต้องตั้งค่าเพิ่ม
// ใช้ตอนลูกค้าเอาบิลมาคืนของ — สแกนแทนการพิมพ์เลขเอกสารด้วยมือ
// =============================================================

/** ลาย 9 ช่อง (แท่ง/ช่องว่างสลับกัน เริ่มที่แท่ง) · n = แคบ, w = กว้าง */
const CODE39: Record<string, string> = {
  "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn",
  "4": "nnnwwnnnw", "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw",
  "8": "wnnwnnwnn", "9": "nnwwnnwnn",
  A: "wnnnnwnnw", B: "nnwnnwnnw", C: "wnwnnwnnn", D: "nnnnwwnnw",
  E: "wnnnwwnnn", F: "nnwnwwnnn", G: "nnnnnwwnw", H: "wnnnnwwnn",
  I: "nnwnnwwnn", J: "nnnnwwwnn", K: "wnnnnnnww", L: "nnwnnnnww",
  M: "wnwnnnnwn", N: "nnnnwnnww", O: "wnnnwnnwn", P: "nnwnwnnwn",
  Q: "nnnnnnwww", R: "wnnnnnwwn", S: "nnwnnnwwn", T: "nnnnwnwwn",
  U: "wwnnnnnnw", V: "nwwnnnnnw", W: "wwwnnnnnn", X: "nwnnwnnnw",
  Y: "wwnnwnnnn", Z: "nwwnwnnnn",
  "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnnwn", $: "nwnwnwnnn",
  "/": "nwnwnnnwn", "+": "nwnnnwnwn", "%": "nnnwnwnwn", "*": "nwnnwnwnn",
};

/** ตัวที่ Code 39 เข้ารหัสไม่ได้ต้องคัดทิ้ง ไม่ใช่แปลงมั่ว — สแกนแล้วได้เลขผิดบิลอันตรายกว่าไม่มีบาร์โค้ด */
export function sanitizeCode39(raw: string): string {
  return raw
    .toUpperCase()
    .split("")
    .filter((ch) => ch !== "*" && ch in CODE39)
    .join("");
}

export type BarcodeBar = { x: number; width: number };

/**
 * แปลงข้อความเป็นแท่งดำ (หน่วยเป็น "โมดูล" — แท่งแคบ = 1, กว้าง = 3)
 * คืน null เมื่อไม่เหลืออักขระที่เข้ารหัสได้ ให้ผู้เรียกข้ามการวาดไปเลย
 */
export function code39Bars(raw: string): { bars: BarcodeBar[]; width: number } | null {
  const text = sanitizeCode39(raw);
  if (!text) return null;

  const bars: BarcodeBar[] = [];
  let x = 0;
  // ต้องมี * ครอบหัวท้ายเสมอ — เครื่องสแกนใช้เป็นตัวบอกจุดเริ่ม/จบ
  for (const ch of `*${text}*`) {
    const pattern = CODE39[ch];
    for (let i = 0; i < pattern.length; i += 1) {
      const w = pattern[i] === "w" ? 3 : 1;
      if (i % 2 === 0) bars.push({ x, width: w });
      x += w;
    }
    x += 1; // ช่องว่างคั่นระหว่างตัวอักษร
  }
  return { bars, width: x - 1 };
}

// =============================================================
// EAN-13 / EAN-8 — สติกเกอร์ติดสินค้า
// -------------------------------------------------------------
// ต่างจาก Code 39 ข้างบนซึ่งใช้กับ "เลขเอกสาร" บนใบเสร็จ · อันนี้ใช้กับ "ตัวสินค้า"
// จึงต้องเป็น EAN จริง เพราะเครื่องสแกนที่ตั้งค่ามาตรฐานอ่าน EAN ได้เสมอ และ
// ระบบค้าปลีกทั้งโลกคาดหวังรูปแบบนี้บนของ
//
// โครงสร้าง EAN-13 = 95 โมดูล:
//   guard(101) + 6 หลักซ้าย(42) + center(01010) + 6 หลักขวา(42) + guard(101)
// หลักแรกไม่ได้ถูกวาดเป็นแท่ง แต่กำหนด "ลาย parity" ของ 6 หลักซ้ายแทน
// นี่คือเหตุผลที่ EAN-13 เก็บ 13 หลักได้ในพื้นที่ของ 12 หลัก
// =============================================================

const EAN_L: Record<string, string> = {
  "0": "0001101", "1": "0011001", "2": "0010011", "3": "0111101", "4": "0100011",
  "5": "0110001", "6": "0101111", "7": "0111011", "8": "0110111", "9": "0001011",
};
const EAN_G: Record<string, string> = {
  "0": "0100111", "1": "0110011", "2": "0011011", "3": "0100001", "4": "0011101",
  "5": "0111001", "6": "0000101", "7": "0010001", "8": "0001001", "9": "0010111",
};
const EAN_R: Record<string, string> = {
  "0": "1110010", "1": "1100110", "2": "1101100", "3": "1000010", "4": "1011100",
  "5": "1001110", "6": "1010000", "7": "1000100", "8": "1001000", "9": "1110100",
};
/** ลาย parity ของ 6 หลักซ้าย เลือกด้วยหลักแรก */
const EAN_PARITY: Record<string, string> = {
  "0": "LLLLLL", "1": "LLGLGG", "2": "LLGGLG", "3": "LLGGGL", "4": "LGLLGG",
  "5": "LGGLLG", "6": "LGGGLL", "7": "LGLGLG", "8": "LGLGGL", "9": "LGGLGL",
};

export type EanRender = {
  bars: BarcodeBar[];
  /** ความกว้างรวมเป็นโมดูล — 95 สำหรับ EAN-13, 67 สำหรับ EAN-8 */
  width: number;
  /**
   * แท่ง guard ต้องยาวกว่าแท่งข้อมูล (หัว กลาง ท้าย) — ไม่ใช่เรื่องความสวย
   * เครื่องสแกนบางรุ่นใช้ guard ที่ยื่นลงมาหาจุดเริ่ม/จบตอนอ่านเฉียง
   */
  guardBarIndexes: number[];
  /** ตัวเลขที่พิมพ์ใต้บาร์โค้ด แยกกลุ่มตามรูปแบบมาตรฐาน */
  humanReadable: { lead: string; left: string; right: string };
};

/**
 * แปลงเลข EAN-13/EAN-8 เป็นแท่งดำ
 * คืน null เมื่อไม่ใช่เลขที่วาดได้ (ความยาวผิด มีตัวอักษร หรือ check digit ผิด)
 *
 * ตรวจ check digit ด้วยโดยตั้งใจ — วาดบาร์โค้ดที่ check digit ผิดออกมาได้แต่
 * เครื่องสแกนจะปฏิเสธ ซึ่งแย่กว่าไม่พิมพ์ให้เลย เพราะร้านจะแปะสติกเกอร์ไปทั้งล็อต
 * แล้วเพิ่งรู้ตอนยืนอยู่หน้าลูกค้า
 */
export function eanBars(raw: string): EanRender | null {
  const code = raw.trim();
  if (!/^\d+$/.test(code)) return null;
  if (code.length !== 13 && code.length !== 8) return null;

  // check digit — สูตรเดียวกับ lib/bms/barcode.ts (คนละ layer จงใจไม่ import ข้าม)
  let sum = 0;
  const body = code.slice(0, -1).split("").reverse();
  for (let i = 0; i < body.length; i += 1) sum += Number(body[i]) * (i % 2 === 0 ? 3 : 1);
  if ((10 - (sum % 10)) % 10 !== Number(code.slice(-1))) return null;

  const pattern: string[] = [];
  if (code.length === 13) {
    const parity = EAN_PARITY[code[0]];
    pattern.push("101");
    for (let i = 0; i < 6; i += 1) {
      pattern.push(parity[i] === "L" ? EAN_L[code[i + 1]] : EAN_G[code[i + 1]]);
    }
    pattern.push("01010");
    for (let i = 7; i < 13; i += 1) pattern.push(EAN_R[code[i]]);
    pattern.push("101");
  } else {
    pattern.push("101");
    for (let i = 0; i < 4; i += 1) pattern.push(EAN_L[code[i]]);
    pattern.push("01010");
    for (let i = 4; i < 8; i += 1) pattern.push(EAN_R[code[i]]);
    pattern.push("101");
  }

  // ตำแหน่งโมดูลของ guard: หัว 0-2, กลาง, ท้าย
  const bits = pattern.join("");
  const centerStart = code.length === 13 ? 45 : 31;
  const isGuardModule = (x: number) =>
    x < 3 || x >= bits.length - 3 || (x >= centerStart && x < centerStart + 5);

  const bars: BarcodeBar[] = [];
  const guardBarIndexes: number[] = [];
  let x = 0;
  while (x < bits.length) {
    if (bits[x] === "1") {
      let w = 1;
      while (bits[x + w] === "1") w += 1;
      if (isGuardModule(x)) guardBarIndexes.push(bars.length);
      bars.push({ x, width: w });
      x += w;
    } else {
      x += 1;
    }
  }

  return {
    bars,
    width: bits.length,
    guardBarIndexes,
    humanReadable: code.length === 13
      ? { lead: code.slice(0, 1), left: code.slice(1, 7), right: code.slice(7) }
      : { lead: "", left: code.slice(0, 4), right: code.slice(4) },
  };
}
