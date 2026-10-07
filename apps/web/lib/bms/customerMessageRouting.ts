import { guessProvinceFromAddress, normalizeProvince } from "./shippingZones";

export function isStoreHoursQuestion(message: string): boolean {
  return /(?:เวลาทำการ|เวลา\s*(?:เปิด|ปิด)|เปิด\s*[-–/]?\s*ปิด|(?:เปิด|ปิด)\s*(?:กี่โมง|เมื่อไหร่|วันไหน|วันอะไร|ไหม|มั้ย)|วันหยุด(?:ร้าน)?|หยุดวันไหน|(?:business|opening|closing|store|shop) hours|\b(?:open|close)\b.*\b(?:when|time|today)\b|\b(?:when|time)\b.*\b(?:open|close)\b)/i.test(message);
}

export function isStoreInfoQuestion(message: string): boolean {
  return isStoreHoursQuestion(message) || /(?:ร้าน(?:ชื่ออะไร|อะไร|อยู่(?:ตรง)?ไหน)|ชื่อร้าน|ติดต่อร้าน|เบอร์ร้าน|ที่อยู่ร้าน|นโยบาย(?:การส่ง|คืนสินค้า)|shipping policy|return policy)/i.test(message);
}

export function isBoardGameVisitQuestion(message: string, archetype: string | null): boolean {
  if (archetype !== "board_game_cafe") return false;
  return /^(?:(?:ผม|หนู|เรา)\s*)?(?:(?:อยาก|สนใจ|ขอ|จะ|มา|ไป|อยากมา|อยากไป)\s*เล่น\s*(?:บอร์ดเกม|เกม)|มี\s*(?:บอร์ดเกม|เกม)\s*(?:ให้เล่น)?\s*(?:ไหม|มั้ย)|(?:i (?:want|would like) to )?play (?:board )?games)[\s!?]*(?:(?:ครับ|ค่ะ|คะ|นะครับ|นะคะ)[\s!?]*)?$/i.test(message.trim());
}

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
