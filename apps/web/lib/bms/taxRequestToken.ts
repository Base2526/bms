import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { isRetailLocalDeployment } from "./deploymentMode";

export const TAX_REQUEST_WINDOW_DAYS = 7; // Technical self-service window, NOT a statutory claim deadline.
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function secret() {
  return (
    process.env.BMS_TAX_REQUEST_SECRET ||
    process.env.BMS_CHECKOUT_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.JWT_SECRET
  );
}
export function taxRequestConfiguration() {
  let origin: string | null = null;
  try {
    const url = new URL(
      process.env.BMS_PUBLIC_ORIGIN || process.env.NEXT_PUBLIC_BASE_URL || ""
    );
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.origin.length <= 150
    )
      origin = url.origin;
  } catch {
    /* An unconfigured public origin never breaks a completed sale. */
  }
  return {
    enabled:
      !isRetailLocalDeployment() &&
      process.env.BMS_TAX_REQUESTS_ENABLED === "true" &&
      Boolean(origin && secret()),
    origin,
  };
}

/** Operator-facing readiness only; never expose signing material or manufacture an ineligible QR. */
export function taxRequestUnavailableReason(hasDocument: boolean, eligible = true): string | null {
  if (!hasDocument) return "บิลนี้ไม่มีใบกำกับภาษีอย่างย่อ จึงยังขอใบกำกับภาษีเต็มรูปผ่าน QR ไม่ได้";
  if (!eligible) return "บิลนี้ถูกยกเลิกหรือมีการคืนสินค้า จึงขอใบกำกับภาษีออนไลน์ไม่ได้";
  if (!taxRequestConfiguration().enabled) return "บริการ QR ขอใบกำกับภาษีออนไลน์ยังไม่พร้อม ให้ผู้ดูแลตรวจการเปิดบริการและ URL HTTPS สาธารณะ";
  return null;
}
const signature = (tenantId: string, orderId: string) =>
  createHmac("sha256", secret()!)
    .update(`bms-tax-request:v1:${tenantId}:${orderId}`)
    .digest("base64url");

/** A purpose-bound request-only capability, never a checkout or document-download token. */
export function taxRequestUrl(
  tenantId: string,
  orderId: string
): string | null {
  const config = taxRequestConfiguration();
  if (!config.enabled || !uuid.test(tenantId) || !uuid.test(orderId))
    return null;
  return `${
    config.origin
  }/tax-invoice/request#${tenantId}.${orderId}.${signature(tenantId, orderId)}`;
}
export function verifyTaxRequestToken(
  token: string
): { tenantId: string; orderId: string } | null {
  if (
    !taxRequestConfiguration().enabled ||
    typeof token !== "string" ||
    token.length > 200
  )
    return null;
  const [tenantId, orderId, sig, extra] = token.split(".");
  if (
    extra ||
    !uuid.test(tenantId ?? "") ||
    !uuid.test(orderId ?? "") ||
    !/^[A-Za-z0-9_-]{43}$/.test(sig ?? "")
  )
    return null;
  const expected = signature(tenantId, orderId);
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ? { tenantId, orderId }
    : null;
}
export function taxRequestAccessHash(secretValue: string): string {
  if (!/^[a-f0-9]{64}$/.test(secretValue))
    throw new Error("ลิงก์ติดตามไม่ถูกต้อง");
  return createHash("sha256").update(secretValue).digest("hex");
}
export function parseTaxRequestAccess(value: string) {
  const [tenantId, id, accessSecret, extra] = String(value).split(".");
  if (extra || !uuid.test(tenantId ?? "") || !uuid.test(id ?? ""))
    throw new Error("ลิงก์ติดตามไม่ถูกต้อง");
  return { tenantId, id, accessHash: taxRequestAccessHash(accessSecret ?? "") };
}
