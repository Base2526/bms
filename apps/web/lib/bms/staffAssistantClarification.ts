// =============================================================
// Staff assistant — deterministic clarification guard
// -------------------------------------------------------------
// The model still handles ordinary language understanding, but a request whose
// meaning of "all" changes the report scope must not silently inherit a tool's
// default date range or result limit.
// =============================================================

const ALL_WORDING = /(ทั้งหมด(?:เลย)?|ทุกอย่าง|\ball\b|\beverything\b)/i;
const SALES_WORDING = /(รายการขาย|ยอดขาย|การขาย|ขายได้|สินค้าที่ขาย|ออร์เดอร์|รายได้|\bsales?\b|\borders?\b|\brevenue\b)/i;

const EXPLICIT_PERIOD = /(วันนี้|เมื่อวาน|สัปดาห์นี้|เดือนนี้|ปีนี้|\d+\s*(?:วัน|สัปดาห์|เดือน|ปี)|ตั้งแต่\s*(?:เริ่มขาย|เปิดร้าน|รายการแรก)|ตลอดมา|ทุกช่วงเวลา|\ball[ -]?time\b|\bsince\s+(?:opening|the beginning)\b|\bfrom\s+\d{4}-\d{2}-\d{2}\b)/i;

const EXPLICIT_VIEW = /(สินค้า(?:ที่ขาย|ขายได้)?|แยกตามสินค้า|รายการออร์เดอร์|ออร์เดอร์ทั้งหมด|ยอดขาย|ยอดรวม|รายได้|\bproducts?\b|\border\s+list\b|\bsales?\s+summary\b|\brevenue\b)/i;

/**
 * Returns a clarification only for a known material ambiguity. A null result
 * means normal staff-AI processing may continue; it does not claim every
 * possible natural-language ambiguity can be recognized deterministically.
 */
export function clarifyAmbiguousStaffRequest(message: string): string | null {
  const text = String(message || "").trim();
  if (!ALL_WORDING.test(text) || !SALES_WORDING.test(text)) return null;

  const hasPeriod = EXPLICIT_PERIOD.test(text);
  const hasView = EXPLICIT_VIEW.test(text);
  if (hasPeriod && hasView) return null;

  if (!hasPeriod && !hasView) {
    return "ขอยืนยันก่อนครับ: คำว่า “ทั้งหมด” หมายถึงทุกช่วงเวลาตั้งแต่เริ่มขาย หรือทุกรายการในช่วงเวลาใด และต้องการดูเป็นสินค้า สรุปยอดขาย หรือรายการออร์เดอร์ครับ?";
  }
  if (!hasPeriod) {
    return "ขอยืนยันช่วงเวลาก่อนครับ: คำว่า “ทั้งหมด” หมายถึงทุกช่วงเวลาตั้งแต่เริ่มขาย หรือทั้งหมดภายในช่วงเวลาใดครับ?";
  }
  return "ขอยืนยันรูปแบบรายการก่อนครับ: ต้องการดูเป็นรายการสินค้า สรุปยอดขาย หรือรายการออร์เดอร์ครับ?";
}
