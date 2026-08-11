import { guessProvinceFromAddress, normalizeProvince } from "./shippingZones";

export function isEnglishCustomerReply(language: string, message: string): boolean {
  if (language === "en") return true;
  if (language !== "th-en") return false;
  const latinCount = (message.match(/[A-Za-z]/g) || []).length;
  const thaiCount = (message.match(/[\u0E00-\u0E7F]/g) || []).length;
  return latinCount > thaiCount;
}

export function couponCodeFromMessage(message: string): string | null {
  const text = String(message || "").trim();
  const match =
    text.match(/(?:ใช้|เช็ก|เช็ค|ตรวจ|ลองใช้|apply)\s+(?:โค้ด|code|คูปอง|coupon)?\s*([A-Z0-9][A-Z0-9_-]{2,31})/i) ??
    text.match(/(?:โค้ด|code|คูปอง|coupon)\s*[:#]?\s*([A-Z0-9][A-Z0-9_-]{2,31})/i);
  return match?.[1]?.trim() ?? null;
}

/** Extract only an explicitly stated destination; never guess from a generic shipping question. */
export function shippingProvinceFromMessage(message: string): string | null {
  const text = String(message || "").trim();
  if (!text) return null;

  const thaiDestination = text.match(
    /(?:ไป|จังหวัด|ปลายทาง(?:คือ|เป็น)?|ส่ง(?:ของ)?ไป(?:ที่)?)\s*((?:จ\.\s*)?[\u0E00-\u0E7F]{2,24}?)(?=\s*(?:เท่า(?:ไร|ไหร่)|กี่|ไหม|มั้ย|หรือเปล่า|ครับ|ค่ะ|คะ|นะ|\?|$))/i
  )?.[1];
  if (thaiDestination) return normalizeProvince(thaiDestination.replace(/^จ\.\s*/, ""));

  const englishDestination = text.match(
    /(?:ship(?:ping)?|deliver(?:y)?)\s+to\s+([A-Za-z][A-Za-z ]{1,30}?)(?=\s*(?:cost|fee|price|how|\?|$))/i
  )?.[1];
  if (englishDestination) return normalizeProvince(englishDestination);

  // Covers explicit short forms such as "ค่าส่ง กทม." without treating an
  // arbitrary word as an upcountry province.
  return guessProvinceFromAddress(text);
}
