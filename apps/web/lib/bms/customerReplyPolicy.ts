import type { PaymentAccount } from "./storeProfile";
import { customerPaymentAccountLines } from "./paymentConfiguration";

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

export type CheckoutReplyStatus = {
  marketplaceManaged: boolean;
  hasRecipientName: boolean;
  hasPhone: boolean;
  hasShippingAddress: boolean;
  shippingAddressCount: number;
  defaultAddressLabel: string | null;
  missingFields: Array<"recipientName" | "phone" | "shippingAddress">;
};

/**
 * Deterministic post-order guidance. Missing payment configuration intentionally produces no
 * payment paragraph, while existing delivery data is reused without asking the customer to type it.
 */
export function checkoutNextStepReply(
  status: CheckoutReplyStatus,
  paymentAccounts: PaymentAccount[]
): string {
  if (status.marketplaceManaged) {
    return "ข้อมูลผู้รับ ที่อยู่ และการชำระเงินใช้งานจาก Seller Center จึงไม่ต้องกรอกซ้ำค่ะ";
  }

  const sections: string[] = [];
  if (status.missingFields.length === 0) {
    const addressLabel = status.defaultAddressLabel
      ? ` “${status.defaultAddressLabel}”`
      : "";
    sections.push(
      `พบข้อมูลผู้รับ เบอร์โทร และที่อยู่จัดส่งเดิม${addressLabel}แล้วค่ะ ทางร้านจะใช้ข้อมูลเดิมให้อัตโนมัติ หากต้องการเปลี่ยนแจ้งได้เลยค่ะ`
    );
  } else {
    const nextMissing = status.missingFields[0];
    if (nextMissing === "recipientName") {
      sections.push("ก่อนจัดส่ง รบกวนแจ้งชื่อผู้รับค่ะ");
    } else if (nextMissing === "phone") {
      sections.push("มีชื่อผู้รับแล้วค่ะ ก่อนจัดส่งรบกวนแจ้งเบอร์โทรศัพท์ที่ติดต่อได้ค่ะ");
    } else {
      sections.push("มีชื่อและเบอร์โทรแล้วค่ะ ก่อนจัดส่งรบกวนแจ้งที่อยู่จัดส่งค่ะ");
    }
  }

  const paymentLines =
    status.missingFields.length === 0
      ? customerPaymentAccountLines(paymentAccounts)
      : [];
  if (paymentLines.length > 0) {
    sections.push(
      `ช่องทางชำระเงินที่ร้านตั้งค่าไว้:\n${paymentLines.join(
        "\n"
      )}\nเมื่อชำระแล้วส่งสลิปมาได้เลยค่ะ ทางร้านจะตรวจสอบก่อนยืนยันยอด`
    );
  }

  return sections.join("\n\n");
}

export function checkoutDetailsFromReply(
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }>
): Record<string, string> | null {
  const lastAssistant =
    [...history].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
  const answer = message
    .trim()
    .replace(/\s*(?:ค่ะ|คะ|ครับ)\s*$/i, "")
    .trim();
  if (!answer) return null;
  if (
    isAlternativeCatalogRequest(answer) ||
    /^(?:ใช้ข้อมูลเดิม|ใช้ที่อยู่เดิม|ไม่เปลี่ยน|ยกเลิก|ไว้ก่อน|พอก่อน)$/i.test(answer)
  ) {
    return null;
  }

  if (
    /(?:รบกวน|กรุณา|ขอ).*?(?:แจ้ง|ส่ง).*?ที่อยู่จัดส่ง/i.test(lastAssistant)
  ) {
    return {
      shippingAddress: answer
        .replace(/^(?:ที่อยู่(?:จัดส่ง)?)\s*[:=-]?\s*/i, "")
        .trim(),
    };
  }
  if (
    /(?:รบกวน|กรุณา|ขอ).*?(?:แจ้ง|ส่ง).*?เบอร์โทร(?:ศัพท์)?/i.test(
      lastAssistant
    )
  ) {
    return {
      phone: answer
        .replace(/^(?:เบอร์(?:โทร(?:ศัพท์)?)?|โทร)\s*[:=-]?\s*/i, "")
        .trim(),
    };
  }
  if (
    /(?:รบกวน|กรุณา|ขอ).*?(?:แจ้ง|ส่ง).*?ชื่อผู้รับ/i.test(lastAssistant)
  ) {
    return {
      recipientName: answer.replace(/^ชื่อ(?:ผู้รับ)?\s*[:=-]?\s*/i, "").trim(),
    };
  }
  return null;
}
