export type ReturnDraft = Record<number, number>;

type ReturnableReceiptLine = {
  orderItemId?: number;
  refundablePackQty?: number;
};

/**
 * แปลงจำนวนที่พนักงานเลือกบนจอเป็น payload คืนสินค้า
 *
 * orderItemId เป็นตัวระบุ variant/pack ที่ขายจริง จึงห้ามรวมด้วย SKU — บิลเดียวกัน
 * อาจมีสินค้ารหัสเดียวกันหลายไซซ์หรือหลายหน่วยขายได้ ส่วนเพดานเป็นข้อมูลจาก
 * recent-receipts ของ server และ server จะตรวจซ้ำภายใต้ row lock ตอนคืนจริงอีกครั้ง
 */
export function selectedReturnLines(
  lines: ReturnableReceiptLine[],
  draft: ReturnDraft
): Array<{ orderItemId: number; packQty: number }> {
  return lines.flatMap((line) => {
    const orderItemId = Number(line.orderItemId);
    const maxQty = Math.floor(Number(line.refundablePackQty ?? 0));
    const requested = Math.floor(Number(draft[orderItemId] ?? 0));
    if (!Number.isInteger(orderItemId) || orderItemId <= 0
        || !Number.isInteger(maxQty) || maxQty <= 0
        || !Number.isInteger(requested) || requested <= 0) {
      return [];
    }
    return [{ orderItemId, packQty: Math.min(requested, maxQty) }];
  });
}
