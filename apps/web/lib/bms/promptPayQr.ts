const PROMPTPAY_MERCHANT_AID = "A000000677010111";
const STATIC_INITIATION_METHOD = "11";
const DYNAMIC_INITIATION_METHOD = "12";
const THB_CURRENCY_CODE = "764";

type Tlv = { id: string; value: string };

export type PromptPayQrDetails = {
  initiationMethod: "11" | "12";
  amount: number | null;
  recipientType: "PHONE" | "NATIONAL_OR_TAX_ID" | "EWALLET" | "BANK_ACCOUNT";
  recipientId: string;
};

function parseTlv(value: string): Tlv[] {
  const fields: Tlv[] = [];
  let offset = 0;
  while (offset < value.length) {
    const header = value.slice(offset, offset + 4);
    if (!/^\d{4}$/.test(header)) throw new Error("INVALID_TLV");
    const length = Number(header.slice(2));
    const start = offset + 4;
    const end = start + length;
    if (end > value.length) throw new Error("INVALID_TLV_LENGTH");
    fields.push({ id: header.slice(0, 2), value: value.slice(start, end) });
    offset = end;
  }
  return fields;
}

function field(fields: Tlv[], id: string): Tlv | null {
  const matches = fields.filter((item) => item.id === id);
  if (matches.length > 1) throw new Error("DUPLICATE_TLV");
  return matches[0] ?? null;
}

function encodeTlv(id: string, value: string): string {
  if (!/^\d{2}$/.test(id) || value.length > 99) throw new Error("INVALID_TLV_VALUE");
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

/** CRC-16/CCITT-FALSE required by EMV merchant-presented QR payloads. */
export function promptPayQrCrc(value: string): string {
  let crc = 0xffff;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code > 0x7f) throw new Error("NON_ASCII_QR_PAYLOAD");
    crc ^= code << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function inspectPromptPayQrPayload(rawPayload: string): PromptPayQrDetails {
  const payload = rawPayload.trim();
  if (!payload || payload.length > 2048 || !/^[\x20-\x7E]+$/.test(payload)) {
    throw new Error("INVALID_QR_PAYLOAD");
  }
  const fields = parseTlv(payload);
  if (field(fields, "00")?.value !== "01") throw new Error("INVALID_PAYLOAD_FORMAT");
  const initiationMethod = field(fields, "01")?.value;
  if (initiationMethod !== STATIC_INITIATION_METHOD && initiationMethod !== DYNAMIC_INITIATION_METHOD) {
    throw new Error("INVALID_INITIATION_METHOD");
  }
  if (field(fields, "53")?.value !== THB_CURRENCY_CODE || field(fields, "58")?.value !== "TH") {
    throw new Error("UNSUPPORTED_CURRENCY_OR_COUNTRY");
  }
  const crcField = fields.at(-1);
  if (!crcField || crcField.id !== "63" || !/^[0-9A-Fa-f]{4}$/.test(crcField.value)) {
    throw new Error("INVALID_CRC_FIELD");
  }
  const crcInput = payload.slice(0, -4);
  if (promptPayQrCrc(crcInput) !== crcField.value.toUpperCase()) throw new Error("INVALID_CRC");

  const merchant = field(fields, "29");
  if (!merchant) throw new Error("PROMPTPAY_MERCHANT_MISSING");
  const merchantFields = parseTlv(merchant.value);
  if (field(merchantFields, "00")?.value !== PROMPTPAY_MERCHANT_AID) {
    throw new Error("NOT_PROMPTPAY_MERCHANT_QR");
  }
  const recipients = [
    { id: "01", type: "PHONE" as const, length: 13 },
    { id: "02", type: "NATIONAL_OR_TAX_ID" as const, length: 13 },
    { id: "03", type: "EWALLET" as const, length: 15 },
    { id: "04", type: "BANK_ACCOUNT" as const, length: null },
  ].flatMap((candidate) => {
    const found = field(merchantFields, candidate.id);
    if (!found) return [];
    if (!/^\d+$/.test(found.value) || (candidate.length != null && found.value.length !== candidate.length)) {
      throw new Error("INVALID_PROMPTPAY_RECIPIENT");
    }
    return [{ type: candidate.type, value: found.value }];
  });
  if (recipients.length !== 1) throw new Error("INVALID_PROMPTPAY_RECIPIENT_COUNT");

  const amountValue = field(fields, "54")?.value ?? null;
  if (amountValue != null && !/^(?:0|[1-9]\d{0,9})\.\d{2}$/.test(amountValue)) {
    throw new Error("INVALID_TRANSACTION_AMOUNT");
  }
  return {
    initiationMethod,
    amount: amountValue == null ? null : Number(amountValue),
    recipientType: recipients[0].type,
    recipientId: recipients[0].value,
  };
}

export function promptPayRecipientId(details: PromptPayQrDetails): string {
  if (details.recipientType === "PHONE") {
    if (!details.recipientId.startsWith("0066")) throw new Error("INVALID_THAI_PHONE_PROXY");
    return `0${details.recipientId.slice(4)}`;
  }
  return details.recipientId;
}

/**
 * Validate a provider-issued reusable base QR. Some Thai banks mark their
 * amount-free account QR with initiation method 12 even though it can be
 * scanned repeatedly. The safety boundary is therefore the absence of Tag 54,
 * not method 11 versus 12; the recipient, currency, country and CRC are still
 * validated by inspectPromptPayQrPayload().
 */
export function validateReusablePromptPayQrPayload(payload: string): PromptPayQrDetails {
  const details = inspectPromptPayQrPayload(payload);
  if (details.amount != null) {
    throw new Error("PROMPTPAY_BASE_QR_MUST_BE_AMOUNT_FREE");
  }
  return details;
}

/** Add this sale's amount to a bank-issued reusable PromptPay QR and recalculate its CRC. */
export function createDynamicPromptPayQrPayload(basePayload: string, amount: number): string {
  validateReusablePromptPayQrPayload(basePayload);
  const amountCents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amountCents <= 0 || amountCents > 100_000_000_000) {
    throw new Error("INVALID_DYNAMIC_QR_AMOUNT");
  }
  const amountValue = (amountCents / 100).toFixed(2);
  if (amountValue.length > 13) throw new Error("DYNAMIC_QR_AMOUNT_TOO_LARGE");

  const baseFields = parseTlv(basePayload.trim()).filter((item) => item.id !== "54" && item.id !== "63");
  const encoded: string[] = [];
  let amountInserted = false;
  for (const item of baseFields) {
    encoded.push(encodeTlv(item.id, item.id === "01" ? DYNAMIC_INITIATION_METHOD : item.value));
    if (item.id === "53") {
      encoded.push(encodeTlv("54", amountValue));
      amountInserted = true;
    }
  }
  if (!amountInserted) throw new Error("TRANSACTION_CURRENCY_MISSING");
  const withoutCrc = `${encoded.join("")}6304`;
  return `${withoutCrc}${promptPayQrCrc(withoutCrc)}`;
}
