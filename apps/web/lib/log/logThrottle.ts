import "server-only";

// =============================================================
// กันพายุ log — error เดียวกันซ้ำ ๆ ไม่ต้องเขียนทุกครั้ง
// -------------------------------------------------------------
// เคสที่กลัว: ฐานล่ม/permission เพี้ยน แล้ว "ทุก request" พังเหมือนกันหมด ถ้าเขียน
// system_logs ทุกครั้งจะกลายเป็นการซ้ำเติมฐานที่กำลังแย่อยู่แล้ว ด้วย INSERT ที่ไม่มี
// ใครได้ประโยชน์ (แถวที่ 2,000 บอกอะไรไม่ต่างจากแถวแรก)
//
// ยอมเสียความละเอียดตรงนี้ได้เพราะ "จำนวนครั้ง" ยังนับครบอยู่ที่ requestMetrics
// (Redis) ซึ่งเป็นตัวนับโดยเฉพาะ — system_logs มีไว้ตอบว่า "พังว่าอะไร" ไม่ใช่
// "พังกี่ครั้ง"
//
// in-memory ต่อ process โดยตั้งใจ: หลาย instance ต่างเขียนของตัวเองได้ ไม่ต้องคุยกัน
// ผ่าน Redis เพื่อประหยัด INSERT ซึ่งจะกลายเป็นการเพิ่ม dependency ให้ path ที่ต้อง
// ทำงานได้แม้ตอนระบบอื่นล่ม
// =============================================================

const lastLoggedAt = new Map<string, number>();

/** กันโตไม่จำกัดตอนคีย์กระจาย (เช่น message มี id ปนมา) */
const MAX_KEYS = 2_000;

export function shouldLog(key: string, windowMs: number): boolean {
  const now = Date.now();
  const prev = lastLoggedAt.get(key);
  if (prev != null && now - prev < windowMs) return false;

  if (lastLoggedAt.size >= MAX_KEYS) lastLoggedAt.clear();
  lastLoggedAt.set(key, now);
  return true;
}

/** error จริง — เก็บถี่กว่าเพราะเป็นของที่ต้องรีบเห็น */
export const ERROR_WINDOW_MS = 10_000;
/** ผู้ใช้กรอกผิด/ไม่มีสิทธิ์ — เก็บไว้ดูแนวโน้มพอ ไม่ต้องทุกครั้ง */
export const EXPECTED_WINDOW_MS = 60_000;
