import { normalizeAssistantQuery } from "./search";
import type { SystemGuide } from "./types";

function normalizePageHelpText(value: string): string {
  return normalizeAssistantQuery(value)
    .replace(/[?!.,:;()[\]{}"'“”‘’…]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const normalizedTerms = (values: readonly string[]) => values.map(normalizePageHelpText);
const includesAny = (value: string, terms: readonly string[]) => terms.some((term) => value.includes(term));

const THAI_PAGE_REFERENCES = normalizedTerms([
  "หน้านี้", "หน้าปัจจุบัน", "หน้าที่เปิดอยู่", "หน้าที่กำลังเปิดอยู่", "หน้าที่ดูอยู่",
]);
const THAI_HELP_TERMS = normalizedTerms([
  "ใช้งาน", "ใช้ยังไง", "ใช้อย่างไร", "วิธีใช้", "วิธีการใช้", "ทำอะไร", "มีไว้", "คืออะไร",
  "อธิบาย", "คู่มือ",
]);
const ENGLISH_PAGE_REFERENCES = normalizedTerms([
  "this page", "current page", "page i am viewing", "page i am on", "open page",
]);
const ENGLISH_HELP_TERMS = normalizedTerms([
  "how", "use", "work", "what", "do", "for", "explain", "tell me about", "guide",
]);
const TROUBLESHOOTING_TERMS = normalizedTerms([
  "ใช้งานไม่ได้", "ใช้ไม่ได้", "เปิดไม่ได้", "ไม่ทำงาน", "ทำอะไรไม่ได้", "แสดงผิด", "ข้อมูลผิด",
  "ข้อมูลหาย", "ค้าง", "ช้า", "โหลด", "เออเรอร์", "error", "cannot", "can't", "does not work",
  "doesn't work", "not working", "broken", "wrong", "missing", "stuck", "slow", "loading",
]);
const COMPREHENSIVE_TERMS = normalizedTerms([
  "ทั้งหมด", "ทุกอย่าง", "ทุกเมนู", "ทุกขั้นตอน", "แบบละเอียด", "อย่างละเอียด", "everything",
  "all features", "all menus", "all steps", "full guide", "in detail",
]);

/**
 * A page-deictic help request points at the validated current route, not the preceding chat topic.
 * Keep this deliberately narrow: an explicit workflow question such as "ปิดกะ POS ยังไง" must
 * still use normal knowledge/tool routing even when the actor happens to be on Dashboard.
 */
export function isCurrentPageHelpRequest(message: string): boolean {
  const normalized = normalizePageHelpText(message);
  if (!normalized || includesAny(normalized, TROUBLESHOOTING_TERMS)) return false;
  const thaiIntent = includesAny(normalized, THAI_PAGE_REFERENCES) && includesAny(normalized, THAI_HELP_TERMS);
  const englishIntent = includesAny(normalized, ENGLISH_PAGE_REFERENCES) && includesAny(normalized, ENGLISH_HELP_TERMS);
  return thaiIntent || englishIntent;
}

export function isComprehensiveCurrentPageHelpRequest(message: string): boolean {
  const normalized = normalizePageHelpText(message);
  return isCurrentPageHelpRequest(message) && includesAny(normalized, COMPREHENSIVE_TERMS);
}

export function guideCoversCurrentPath(
  guide: Pick<SystemGuide, "route" | "coversRoutePrefixes">,
  currentPath: string
): boolean {
  if (currentPath === guide.route || currentPath.startsWith(`${guide.route}/`)) return true;
  return (guide.coversRoutePrefixes ?? []).some(
    (prefix) => currentPath === prefix || currentPath.startsWith(`${prefix}/`)
  );
}
