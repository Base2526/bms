import { ToolArgError } from "./types";

/** Model-supplied quote lines must not silently become a different parcel. */
export function shippingEstimateItems(value: unknown): { sku: string; qty: number }[] | null {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 20) {
    throw new ToolArgError('"items" ต้องเป็นรายการสินค้าไม่เกิน 20 รายการ');
  }
  if (value.length === 0) return null;
  return value.map((line: unknown, index: number) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      throw new ToolArgError(`items[${index}] ไม่ถูกต้อง`);
    }
    const item = line as Record<string, unknown>;
    if (Object.keys(item).some((key) => key !== "sku" && key !== "qty")) {
      throw new ToolArgError(`items[${index}] มี field ที่ไม่รองรับ`);
    }
    const sku = typeof item.sku === "string" ? item.sku.trim() : "";
    if (!sku || sku.length > 200) throw new ToolArgError(`items[${index}].sku ไม่ถูกต้อง`);
    if (typeof item.qty !== "number" || !Number.isSafeInteger(item.qty) || item.qty < 1) {
      throw new ToolArgError(`items[${index}].qty ต้องเป็นจำนวนเต็ม ≥ 1`);
    }
    return { sku, qty: item.qty };
  });
}
