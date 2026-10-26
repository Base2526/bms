import {
  createStockTransfer,
  sendStockTransfer,
  receiveStockTransfer,
  cancelStockTransfer,
  type CreateTransferResult,
  type TransferActionResult,
} from "./stockTransfers";
import { isIdempotencyConflictError } from "./idempotencyErrors";

const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown) =>
  v == null || (typeof v === "string" && v.length <= 4000);
const qty = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 2147483647;
type Result =
  | CreateTransferResult
  | TransferActionResult
  | { status: "CONFLICT"; reason: string };

/** Both authenticated staff adapters use this boundary; actor/tenant never come from input. */
export async function commandStaffStockTransfer(
  tenantId: string,
  actorUserId: string,
  input: unknown
): Promise<Result> {
  const invalid = (reason: string): Result => ({ status: "INVALID", reason });
  if (!record(input)) return invalid("ข้อมูลคำสั่งไม่ถูกต้อง");
  if (
    typeof input.idempotencyKey !== "string" ||
    input.idempotencyKey.trim().length < 8 ||
    input.idempotencyKey.trim().length > 200
  )
    return invalid(
      "ต้องระบุ idempotencyKey ยาว 8–200 ตัวอักษร และใช้ค่าเดิมเมื่อลองใหม่"
    );
  const common = {
    tenantId,
    actorUserId,
    staffScope: true as const,
    idempotencyKey: input.idempotencyKey.trim(),
  };
  try {
    if (input.action === "create") {
      if (
        !uuid(input.fromLocationId) ||
        !uuid(input.toLocationId) ||
        !text(input.note)
      )
        return invalid("สาขาหรือหมายเหตุไม่ถูกต้อง");
      if (
        !Array.isArray(input.items) ||
        !input.items.length ||
        input.items.length > 500 ||
        input.items.some(
          (i) =>
            !record(i) ||
            typeof i.sku !== "string" ||
            !i.sku.trim() ||
            i.sku.length > 200 ||
            typeof i.size !== "string" ||
            !i.size.trim() ||
            i.size.length > 200 ||
            !qty(i.qty) ||
            i.qty === 0
        )
      )
        return invalid(
          "รายการสินค้าไม่ถูกต้อง ต้องระบุ SKU ไซซ์ และจำนวนเต็มบวก"
        );
      return await createStockTransfer({
        ...common,
        createdBy: actorUserId,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        items: input.items as Array<{ sku: string; size: string; qty: number }>,
        note: input.note as string | null | undefined,
      });
    }
    if (!uuid(input.transferId)) return invalid("transferId ไม่ถูกต้อง");
    const action = { ...common, transferId: input.transferId };
    if (input.action === "send") return await sendStockTransfer(action);
    if (input.action === "cancel") return await cancelStockTransfer(action);
    if (input.action === "receive") {
      if (
        !text(input.receivingNote) ||
        (input.received != null &&
          (!Array.isArray(input.received) ||
            input.received.length > 500 ||
            input.received.some(
              (i) =>
                !record(i) ||
                !qty(i.itemId) ||
                !i.itemId ||
                !qty(i.qty) ||
                (i.damagedQty != null && !qty(i.damagedQty)) ||
                !text(i.reason) ||
                !text(i.note)
            )))
      )
        return invalid("ข้อมูลตรวจรับไม่ถูกต้อง");
      return await receiveStockTransfer({
        ...action,
        received:
          (input.received as Parameters<
            typeof receiveStockTransfer
          >[0]["received"]) ?? undefined,
        receivingNote: input.receivingNote as string | null | undefined,
      });
    }
    return invalid("action ไม่ถูกต้อง");
  } catch (error) {
    if (isIdempotencyConflictError(error))
      return { status: "CONFLICT", reason: error.message };
    throw error;
  }
}
