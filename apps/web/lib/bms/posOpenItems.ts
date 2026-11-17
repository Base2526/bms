/** Sale-time goods without a catalog record. Money is exact to satang; no stock is implied. */
export type PosOpenItem = {
  label: string;
  qty: number;
  unitAmount: number;
  vatCategory: "V" | "N";
};

export function parsePosOpenItems(raw: unknown):
  | { ok: true; items: PosOpenItem[] }
  | { ok: false; reason: string } {
  if (raw == null) return { ok: true, items: [] };
  if (!Array.isArray(raw) || raw.length > 10) {
    return { ok: false, reason: "รายการขายชั่วคราวต้องเป็นรายการไม่เกิน 10 บรรทัด" };
  }
  const items: PosOpenItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") return { ok: false, reason: "รายการขายชั่วคราวไม่ถูกต้อง" };
    const value = row as Record<string, unknown>;
    const label = typeof value.label === "string" ? value.label.trim() : "";
    const qty = value.qty;
    const unitAmount = value.unitAmount;
    const vatCategory = value.vatCategory;
    if (!label || label.length > 120 || /[\u0000-\u001f\u007f]/u.test(label)) {
      return { ok: false, reason: "ชื่อสินค้าชั่วคราวต้องมี 1–120 ตัวอักษรและไม่มีอักขระควบคุม" };
    }
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 9999) {
      return { ok: false, reason: "จำนวนสินค้าชั่วคราวต้องเป็นจำนวนเต็ม 1–9999" };
    }
    if (typeof unitAmount !== "number" || !Number.isFinite(unitAmount)
      || unitAmount <= 0 || unitAmount > 9999999.99
      || Math.abs(Math.round(unitAmount * 100) - unitAmount * 100) > 0.000001) {
      return { ok: false, reason: "ราคาสินค้าชั่วคราวต้องเป็นจำนวนบวกที่มีทศนิยมไม่เกินสองตำแหน่ง" };
    }
    if (vatCategory !== "V" && vatCategory !== "N") {
      return { ok: false, reason: "ต้องระบุประเภท VAT ของสินค้าชั่วคราว" };
    }
    if (qty * unitAmount > 9999999999.99) {
      return { ok: false, reason: "ยอดสินค้าชั่วคราวเกินวงเงินต่อบรรทัด" };
    }
    items.push({ label, qty, unitAmount, vatCategory });
  }
  return { ok: true, items };
}
