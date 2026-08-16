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
