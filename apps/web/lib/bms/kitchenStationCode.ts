// =============================================================
// รหัส/ชื่อสถานีครัว — การทำให้เป็นรูปแบบมาตรฐาน (pure, ไม่ import อะไรเลย)
// -------------------------------------------------------------
// แยกเป็นโมดูลของตัวเองแบบ `productStockPolicyOptions.ts` เพราะฟอร์มหลังบ้าน (ดูรหัสก่อน
// กดบันทึก) กับ service (ตรวจก่อนเขียน) ต้องได้คำตอบเดียวกันเป๊ะ · ไมเกรชัน `9.54` ทำ
// ลำดับเดียวกันแต่ **ไม่ต้องได้ผลตรงกันแบบไบต์ต่อไบต์** เพราะการจับคู่สถานีใช้ "ชื่อ" ไม่ใช่
// รหัส — สิ่งที่ต้องตรงกันคือทั้งสองฝั่งผ่าน CHECK เดียวกันของตาราง
// =============================================================

export const KITCHEN_STATION_CODE_MAX = 32;
export const KITCHEN_STATION_NAME_MAX = 64;
export const KITCHEN_STATION_DESCRIPTION_MAX = 200;
export const KITCHEN_STATION_SORT_MIN = -9999;
export const KITCHEN_STATION_SORT_MAX = 9999;

/** รหัสสำรองเมื่อชื่อไม่มีตัวอักษร/ตัวเลขให้ใช้เลย (เช่น "•••") */
export const KITCHEN_STATION_FALLBACK_CODE = "STATION";

/**
 * รหัสที่ใช้ได้: ตัวอักษรหรือตัวเลขของภาษาไหนก็ได้ บวก `_` และ `-` — **ไม่บังคับ A-Z**
 *
 * ร้านไทยตั้งชื่อครัวเป็นภาษาไทย ("ครัวร้อน", "บาร์") การบังคับ A-Z จะทำให้รหัสของทุกสถานี
 * กลายเป็น STATION, STATION_2, STATION_3 ซึ่งอ่านไม่ออกและเรียงไม่ได้ · `upper()` ของ
 * Postgres กับ `toUpperCase()` ของ JS ไม่เปลี่ยนอักษรไทย ทั้งสองฝั่งจึงได้ผลเท่ากัน
 */
// ⚠️ `\p{M}` (combining marks) ต้องอยู่ในชุดที่อนุญาต ไม่งั้น **สระและวรรณยุกต์ไทยถูกตัดทิ้ง**
// "ครัวร้อน" กลายเป็น "คร_วร_อน" เพราะ ั และ ้ เป็น Mn ไม่ใช่ L (เจอด้วยเทส ไม่ใช่ด้วยสายตา)
const CODE_ALLOWED = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}_-]*$/u;
const CODE_DISALLOWED_RUN = /[^\p{L}\p{N}\p{M}_-]+/gu;

/**
 * แปลงข้อความอะไรก็ได้ให้เป็นรหัสสถานี — ตัวพิมพ์ใหญ่ · อะไรที่ไม่ใช่ตัวอักษร/ตัวเลข/เครื่องหมาย
 * ประกอบ/`_`/`-` กลายเป็น `_` · ตัด `_` หัวท้าย · ตัดที่ 32 **แล้วค่อยตัด `_` ท้ายอีกครั้ง**
 *
 * ลำดับ "ตัดความยาวก่อน แล้วค่อยตัด `_`" สำคัญ: กลับลำดับแล้วชื่อยาว ๆ จะได้รหัสลงท้ายด้วย
 * `_` ซึ่งผ่าน CHECK แต่คนอ่านว่าพิมพ์ตกหล่น (มีเทสคุมทั้งที่นี่และในไฟล์ `9.54`)
 */
export function normalizeKitchenStationCode(value: string | null | undefined): string {
  const raw = String(value ?? "").trim().toUpperCase();
  // ตัดทั้ง `_` และ `-` ที่หัวท้าย ไม่ใช่แค่ `_` — "---" เคยผ่านมาเป็น "---" ซึ่ง
  // isValidKitchenStationCode() ปฏิเสธทีหลัง (รหัสต้องขึ้นต้นด้วยตัวอักษรหรือตัวเลข)
  // แล้วผู้ใช้เจอ error ที่พูดถึงรูปแบบรหัสทั้งที่ไม่เคยพิมพ์รหัสเอง
  const slug = raw.replace(CODE_DISALLOWED_RUN, "_").replace(/^[-_]+|[-_]+$/g, "");
  const code = slug.slice(0, KITCHEN_STATION_CODE_MAX).replace(/[-_]+$/g, "");
  return code || KITCHEN_STATION_FALLBACK_CODE;
}

/** true เมื่อรหัสอยู่ในรูปที่ฐานข้อมูลรับได้แล้ว (ใช้ตรวจค่าที่คนพิมพ์เองในฟอร์ม) */
export function isValidKitchenStationCode(value: string | null | undefined): boolean {
  const code = String(value ?? "");
  if (!code || code.length > KITCHEN_STATION_CODE_MAX) return false;
  if (code !== code.trim() || code !== code.toUpperCase()) return false;
  return CODE_ALLOWED.test(code);
}

/**
 * ชื่อสถานีที่พร้อมเก็บ — ยุบช่องว่างซ้อนเป็นช่องเดียว
 *
 * "บาร์  เครื่องดื่ม" กับ "บาร์ เครื่องดื่ม" ต้องเป็นสถานีเดียวกัน ไม่งั้นดัชนี unique ของชื่อ
 * จะปล่อยให้สองแถวที่คนอ่านว่าเหมือนกันอยู่ร่วมกันได้ แล้วเกณฑ์เวลา (ซึ่งคีย์ด้วยชื่อ)
 * มีคำตอบสองคำตอบ
 */
export function normalizeKitchenStationName(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, KITCHEN_STATION_NAME_MAX).trim();
}
