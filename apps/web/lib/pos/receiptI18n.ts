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
