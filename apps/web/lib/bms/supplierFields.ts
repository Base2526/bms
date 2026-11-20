export type SupplierFields = {
  name: string;
  phone: string | null;
  email: string | null;
  note: string | null;
  taxId: string | null;
  branchCode: string | null;
  address: string | null;
  entityType: "INDIVIDUAL" | "JURISTIC" | null;
};

export type SupplierInput = Partial<SupplierFields>;

export function normalizeSupplierFields(input: SupplierInput, current?: SupplierFields): SupplierFields {
  const value = <K extends keyof SupplierFields>(key: K): SupplierFields[K] | undefined =>
    input[key] === undefined ? current?.[key] : input[key];
  const text = (key: keyof SupplierFields, max: number): string | null => {
    const raw = value(key);
    if (raw == null) return null;
    if (typeof raw !== "string") throw new Error(`ข้อมูลผู้ขาย ${key} ไม่ถูกต้อง`);
    const normalized = raw.trim();
    if (normalized.length > max) throw new Error(`ข้อมูลผู้ขาย ${key} ยาวเกิน ${max} ตัวอักษร`);
    return normalized || null;
  };
  const name = text("name", 120);
  if (!name) throw new Error("ต้องระบุชื่อผู้ขาย");
  const phone = text("phone", 30);
  if (phone && (!/^[0-9+()\-\s]{8,30}$/.test(phone) || phone.replace(/\D/g, "").length < 8)) {
    throw new Error("เบอร์โทรผู้ขายไม่ถูกต้อง");
  }
  const email = text("email", 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("อีเมลผู้ขายไม่ถูกต้อง");
  const taxId = text("taxId", 13);
  if (taxId && !/^\d{13}$/.test(taxId)) throw new Error("เลขผู้เสียภาษีผู้ขายต้องเป็นเลข 13 หลัก");
  const branchCode = text("branchCode", 5);
  if (branchCode && !/^\d{5}$/.test(branchCode)) throw new Error("รหัสสาขาผู้ขายต้องเป็นเลข 5 หลัก");
  const entityType = text("entityType", 20);
  if (entityType && entityType !== "INDIVIDUAL" && entityType !== "JURISTIC") {
    throw new Error("ประเภทผู้ขายไม่ถูกต้อง");
  }
  return { name, phone, email, note: text("note", 1000), taxId, branchCode,
    address: text("address", 500),
    entityType: entityType === "INDIVIDUAL" || entityType === "JURISTIC" ? entityType : null };
}
