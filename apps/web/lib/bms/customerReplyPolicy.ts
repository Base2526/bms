const ALTERNATIVE_CATALOG_PATTERN =
  /(?:ขอ)?(?:ดู|ชม|หา)?\s*(?:สินค้า|รุ่น|แบบ|ตัว|อัน|อย่าง)?\s*อื่น(?:ๆ|เพิ่ม|อีก|เพิ่มเติม)?|(?:มี|เอา|ขอ)\s*(?:สินค้า|รุ่น|แบบ|ตัว|อัน|อย่าง)?\s*อื่น/i;

const PAYMENT_CHANNEL_ADVICE_PATTERN =
  /(?:ช่องทาง|วิธี).*(?:ชำระ|โอน)|ชำระผ่าน|โอน(?:เข้า)?บัญชี|โอนธนาคาร|บัญชีธนาคาร|พร้อมเพย์|promptpay/i;

const PAYMENT_ADVICE_START_PATTERN =
  /(?:ตอนนี้รอการชำระ[^.!?\n]*|สนใจชำระผ่าน|สะดวกชำระผ่าน|ต้องการชำระผ่าน|ลูกค้าสะดวกโอนผ่าน|ชำระผ่านช่องทางไหน)/i;

export function isAlternativeCatalogRequest(message: string): boolean {
  return ALTERNATIVE_CATALOG_PATTERN.test(String(message || "").trim());
}

export function suppressUnconfiguredPaymentAdvice(reply: string): string {
  const text = String(reply || "").trim();
  if (!PAYMENT_CHANNEL_ADVICE_PATTERN.test(text)) return text;

  const adviceStart = text.search(PAYMENT_ADVICE_START_PATTERN);
  if (adviceStart > 0) {
    const preserved = text.slice(0, adviceStart).trim();
    if (preserved) return preserved;
  }

  const preservedParagraphs = text
    .split(/\n{2,}/)
    .filter((paragraph) => !PAYMENT_CHANNEL_ADVICE_PATTERN.test(paragraph))
    .join("\n\n")
    .trim();
  return (
    preservedParagraphs ||
    "ตอนนี้ทางร้านยังไม่ได้ระบุช่องทางชำระเงินไว้ค่ะ กรุณารอแอดมินแจ้งรายละเอียดก่อนนะคะ"
  );
}
