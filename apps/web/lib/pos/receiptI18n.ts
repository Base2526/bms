export const RECEIPT_LANGUAGE_MODES = ["th", "en", "bilingual"] as const;

export type ReceiptLanguageMode = (typeof RECEIPT_LANGUAGE_MODES)[number];

export function isReceiptLanguageMode(value: unknown): value is ReceiptLanguageMode {
  return RECEIPT_LANGUAGE_MODES.includes(value as ReceiptLanguageMode);
}

export function receiptLabel(mode: ReceiptLanguageMode, thai: string, english: string): string {
  if (mode === "en") return english;
  if (mode === "bilingual") return `${thai} / ${english}`;
  return thai;
}

export function receiptLocale(mode: ReceiptLanguageMode): string {
  return mode === "en" ? "en-US" : "th-TH";
}

export function receiptDocumentTitle(
  mode: ReceiptLanguageMode,
  kind: "sale" | "return" | "exchange",
  vatRegistered = false
): string {
  if (kind === "return") return receiptLabel(mode, "ใบรับคืนสินค้า", "Goods Return Receipt");
  if (kind === "exchange") return receiptLabel(mode, "ใบเตรียมเปลี่ยนสินค้า", "Exchange Preparation Receipt");
  return vatRegistered
    ? receiptLabel(mode, "ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ", "Receipt/Abbreviated Tax Invoice")
    : receiptLabel(mode, "ใบเสร็จรับเงิน", "Receipt");
}

/**
 * ป้ายวิธีชำระเงินบนใบเสร็จ/ประวัติบิล
 *
 * อยู่ใน lib เพราะ **เครื่องขายสองหน้าใช้ชุดเดียวกัน** — เดิมอยู่ในไฟล์หน้าค้าปลีกไฟล์เดียว
 * พอหน้าร้านอาหารต้องพิมพ์รายวิธีชำระด้วย ทางเลือกคือก็อปตารางไปอีกชุด แล้ววันที่ใครเพิ่ม
 * วิธีชำระใหม่ อีกหน้าจะพิมพ์รหัสดิบ (`STORE_CREDIT`) ให้ลูกค้าอ่านเอง
 */
export function posPaymentMethodLabel(method: string, mode: ReceiptLanguageMode = "th"): string {
  switch (method) {
    case "CASH": return receiptLabel(mode, "เงินสด", "Cash");
    case "QR": return "QR";
    case "CARD": return receiptLabel(mode, "บัตร", "Card");
    case "WALLET": return receiptLabel(mode, "วอลเล็ท", "Wallet");
    case "BANK_TRANSFER": return receiptLabel(mode, "โอนเงิน", "Bank transfer");
    // ขายเชื่อ (9.30) / เครดิตร้าน (8.9) ไม่ได้อยู่ในปุ่มหลัก แต่ต้องอ่านออกบนใบเสร็จ
    case "CREDIT": return receiptLabel(mode, "ขายเชื่อ", "Credit sale");
    case "STORE_CREDIT": return receiptLabel(mode, "เครดิตร้าน", "Store credit");
    default: return method;
  }
}
