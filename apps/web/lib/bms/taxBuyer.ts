import { isValidThaiTaxId } from "./thaiTaxId";

/** VAT registration and legal personality are independent. Missing flag preserves old clients. */
export function normalizeTaxBuyer(buyer: {
  name?: unknown; taxId?: unknown; branchCode?: unknown; address?: unknown; phone?: unknown;
  buyerType?: unknown; vatRegistered?: unknown;
}) {
  const text = (value: unknown, max: number) => {
    if (value == null) return "";
    if (typeof value !== "string" || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
      throw new Error("ข้อมูลผู้ซื้อไม่ถูกต้อง / Invalid buyer details");
    return value.trim();
  };
  const kind = buyer.buyerType ?? null;
  if (kind !== null && !["COMPANY", "INDIVIDUAL", "FOREIGNER"].includes(String(kind)))
    throw new Error("ประเภทผู้ซื้อไม่ถูกต้อง / Invalid buyer type");
  if (buyer.vatRegistered != null && typeof buyer.vatRegistered !== "boolean")
    throw new Error("สถานะจด VAT ไม่ถูกต้อง / Invalid VAT registration");
  const vatRegistered = buyer.vatRegistered ?? (kind === null || kind === "COMPANY");
  const name = text(buyer.name, 200), address = text(buyer.address, 1000);
  const taxId = text(buyer.taxId, 13) || null;
  const branchCode = vatRegistered ? text(buyer.branchCode, 5) || "00000" : null;
  if (!name || !address) throw new Error("ต้องระบุชื่อและที่อยู่ผู้ซื้อ / Buyer name and address required");
  if ((vatRegistered && !taxId) || (taxId && !isValidThaiTaxId(taxId)))
    throw new Error("เลขประจำตัวผู้เสียภาษีต้องมี 13 หลักและ checksum ถูกต้อง / Invalid Thai tax ID");
  if (branchCode !== null && !/^\d{5}$/.test(branchCode))
    throw new Error("รหัสสาขาต้องมี 5 หลัก / Branch code must have five digits");
  return { name, address, taxId, branchCode, phone: text(buyer.phone, 30) || null, vatRegistered: Boolean(vatRegistered) };
}
