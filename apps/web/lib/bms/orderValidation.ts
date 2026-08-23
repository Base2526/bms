export type ValidatableOrderItem = {
  sku: string;
  size: string;
  qty: number;
};

const POSTGRES_INTEGER_MAX = 2_147_483_647;

/** Reject a malformed line instead of silently creating only the valid subset. */
export function validateOrderItems(
  items: ValidatableOrderItem[]
): { ok: true } | { ok: false; index: number; reason: string } {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, index: -1, reason: "ต้องมีสินค้าอย่างน้อย 1 รายการ" };
  }
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item || !String(item.sku ?? "").trim()) {
      return { ok: false, index, reason: "SKU ห้ามว่าง" };
    }
    if (!String(item.size ?? "").trim()) {
      return { ok: false, index, reason: "ขนาด/ตัวเลือกสินค้าห้ามว่าง" };
    }
    if (!Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > POSTGRES_INTEGER_MAX) {
      return { ok: false, index, reason: "จำนวนต้องเป็นจำนวนเต็มบวกที่บันทึกได้" };
    }
  }
  return { ok: true };
}
