// Pure contract shared by intake, review and tests. Quantities are selling-unit counts.
import { type OrderQuoteLine } from './orderQuote';

/**
 * A refusal the caller can still act on — **not** a server failure.
 *
 * Intake runs as an AI tool. `runtime.ts` treats any thrown error that is not a
 * ToolArgError as a system failure: it hides the real text behind
 * "ดึงข้อมูลไม่สำเร็จ" and opens an `ai.tool_failed` incident. Every refusal here is
 * either something the model must fix (ask for the branch, ask pickup vs delivery,
 * pick a real modifier) or ordinary shop state (paused, outside ordering hours) — so
 * a plain `Error` both hides the instruction the model needed and pages the operator
 * once per customer message while the shop is closed.
 *
 * `createOrderInTx()` answers the same questions with status codes for the same
 * reason; this class gives the request path that guarantee without turning 20
 * refusals into a status enum. It deliberately carries **no `code` property**: the
 * REST routes rethrow anything with `code` (that is how a pg error keeps its
 * SQLSTATE and its 500), and a business refusal must stay a 400 with its message.
 */
export class RestaurantRequestRejection extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestaurantRequestRejection';
  }
}
export function isRestaurantRequestRejection(error: unknown): error is RestaurantRequestRejection {
  return error instanceof RestaurantRequestRejection;
}

/**
 * Refusals the request path answers with a **status**, borrowed verbatim from createOrderInTx.
 *
 * These four are not mistakes in the basket, they are the shop's own state: it paused ordering,
 * it is outside its hours, it has several branches, or nobody said pickup vs delivery. The order
 * path has always answered them as statuses, and orderReply() in pipeline.ts already turns each
 * one into a sentence a customer can act on ("the kitchen has paused online orders", plus the
 * actual branch names). Answering them as prose aimed at the model instead left the customer
 * who typed "ยืนยัน" with a generic "could not be received" and no reason.
 */
export const RESTAURANT_REQUEST_REFUSAL_STATUSES = [
  'ORDERING_PAUSED', 'ORDERING_CLOSED', 'LOCATION_REQUIRED', 'FULFILLMENT_REQUIRED',
] as const;
export function isRestaurantRequestRefusal(data: unknown): data is { status: string } {
  const status = (data as { status?: unknown } | null)?.status;
  return typeof status === 'string'
    && (RESTAURANT_REQUEST_REFUSAL_STATUSES as readonly string[]).includes(status);
}

export type RestaurantRequestItem = {
  sku: string; size: string; qty: number; packCode?: string | null; modifierCodes?: string[];
};
export type RestaurantRequestLine = RestaurantRequestItem & {
  name: string; unitName: string | null; modifierNames: string[];
};
export type RestaurantRequestDraft = {
  items: RestaurantRequestItem[]; locationId: string; fulfillmentType: 'DELIVERY' | 'PICKUP';
  promisedAt: string | null; requestNote: string; couponCode: string | null;
};
export function normalizeRestaurantRequestItems(value: unknown): RestaurantRequestItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new RestaurantRequestRejection('ต้องมี 1–20 รายการ');
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new RestaurantRequestRejection('รายการไม่ถูกต้อง');
    const { sku, size, qty, packCode, modifierCodes } = raw;
    if (typeof sku !== 'string' || !sku.trim() || sku.length > 120 ||
        typeof size !== 'string' || !size.trim() || size.length > 120 ||
        !Number.isInteger(qty) || qty < 1 || qty > 100000) throw new RestaurantRequestRejection('ต้องระบุสินค้า ตัวเลือก และจำนวนเต็ม 1–100000');
    if (packCode != null && (typeof packCode !== 'string' || packCode.length > 64)) throw new RestaurantRequestRejection('หน่วยขายไม่ถูกต้อง');
    if (modifierCodes != null && (!Array.isArray(modifierCodes) || modifierCodes.length > 20 ||
      modifierCodes.some((code: unknown) => typeof code !== 'string' || !code.trim() || code.length > 64))) throw new RestaurantRequestRejection('ตัวเลือกเมนูไม่ถูกต้อง');
    return { sku: sku.trim(), size: size.trim(), qty, packCode: packCode?.trim().toUpperCase() || null,
      modifierCodes: [...new Set<string>((modifierCodes ?? []).map((code: string) => code.trim().toUpperCase()))].sort() };
  });
}
export function restaurantRequestFingerprint(items: RestaurantRequestItem[], locationId: string,
  fulfillmentType: string, requestedAt: string | null, note: string, couponCode: string | null): string {
  // Order matters: free-text instructions may refer to line/portion numbers.
  return JSON.stringify([normalizeRestaurantRequestItems(items), locationId, fulfillmentType, requestedAt, note, couponCode]);
}
export function agreedRestaurantQuantities(lines: RestaurantRequestLine[], quantities: unknown): RestaurantRequestItem[] {
  if (!Array.isArray(quantities) || quantities.length !== lines.length ||
      quantities.some((qty, i) => !Number.isInteger(qty) || qty < 0 || qty > lines[i].qty)) {
    throw new RestaurantRequestRejection('จำนวนที่ตกลงต้องครบทุกบรรทัด ตั้งแต่ 0 ถึงจำนวนที่ลูกค้าขอ');
  }
  const items = lines.map((line, i) => ({ ...line, qty: quantities[i] })).filter((line) => line.qty > 0);
  if (!items.length) throw new RestaurantRequestRejection('ไม่มีรายการที่รับได้ — ใช้ยกเลิกคำขอ');
  return items;
}
export function requestQuoteLines(lines: RestaurantRequestLine[]): OrderQuoteLine[] {
  return lines.map((line) => ({ sku: line.sku, name: line.name, size: line.size, displayQty: line.qty,
    packUnitName: line.unitName, modifiers: line.modifierNames.map((name, i) => ({ code: line.modifierCodes?.[i] ?? '', name, priceDelta: 0 })) }));
}
export function restaurantRequestReceipt(id: string, english = false): string {
  return english
    ? `Request ${id.slice(0, 8)} received with your requested quantities. The shop will review availability and call if changes are needed. This is not a confirmed order; no stock or payment has been reserved. Please provide a contact phone number if you have not already done so.`
    : `รับคำขอ ${id.slice(0, 8)} ตามจำนวนที่แจ้งไว้แล้วค่ะ ร้านจะตรวจความพร้อมและโทรติดต่อหากต้องปรับรายการ ยังไม่ใช่ออร์เดอร์ที่ร้านยืนยัน และยังไม่จองสต็อกหรือเรียกชำระเงินค่ะ หากยังไม่ได้ให้เบอร์ติดต่อ รบกวนแจ้งเบอร์โทรด้วยนะคะ`;
}

/**
 * What "where is my order?" must answer while a request is still in the queue.
 *
 * A restaurant customer's order question is usually about a request that has no order row yet.
 * The plain order-status reply says "no order was found for this account", which reads as the
 * shop having lost it — so the pending request is named instead, and it repeats that nothing is
 * reserved or owed, because that is the fact a waiting customer keeps asking about.
 */
export function restaurantRequestStatusLine(request: { id: string; status: string }, english = false): string {
  const ref = request.id.slice(0, 8);
  if (request.status === 'CONTACTING') {
    return english
      ? `Request ${ref}: the shop is contacting you about it. Nothing is reserved or charged yet.`
      : `คำขอ ${ref}: ร้านกำลังติดต่อกลับเรื่องรายการนี้ค่ะ ยังไม่จองสต็อกและยังไม่ต้องชำระเงิน`;
  }
  return english
    ? `Request ${ref}: waiting for the shop to review availability. No stock is reserved and no payment is due; the shop will call if anything has to change.`
    : `คำขอ ${ref}: รอร้านตรวจความพร้อมค่ะ ยังไม่จองสต็อกและยังไม่ต้องชำระเงิน ร้านจะโทรติดต่อหากต้องปรับรายการ`;
}

export function restaurantRequestSummary(quote: {
  lines: OrderQuoteLine[]; locationName: string; fulfillmentType: string; requestedAt: string | null; note: string;
}, english = false): string {
  return [english ? 'Please confirm your request (subject to shop review):' : 'ตรวจรายการที่ต้องการให้ร้านรับไว้ก่อนนะคะ (รอร้านตรวจความพร้อม):',
    ...quote.lines.map((line) => `• ${line.name} / ${line.size} × ${line.displayQty}${line.packUnitName ? ` ${line.packUnitName}` : ''}${line.modifiers?.length ? ` (${line.modifiers.map((m) => m.name).join(', ')})` : ''}`),
    `${english ? 'Branch' : 'สาขา'}: ${quote.locationName} · ${quote.fulfillmentType === 'PICKUP' ? (english ? 'Pickup' : 'รับเอง') : (english ? 'Delivery' : 'จัดส่ง')}`,
    ...(quote.requestedAt ? [`${english ? 'Requested time (not yet promised)' : 'เวลาที่ต้องการ (ร้านยังไม่ยืนยัน)'}: ${quote.requestedAt}`] : []),
    ...(quote.note ? [`${english ? 'Instructions for shop review' : 'ข้อกำชับให้ร้านตรวจ'}: ${quote.note}`] : []),
    english ? 'Reply "confirm" to submit these quantities. The shop will call if changes are needed. No payment is requested yet.'
      : 'พิมพ์ "ยืนยัน" เพื่อส่งคำขอตามจำนวนนี้ ร้านจะโทรหากต้องปรับรายการ ยังไม่ต้องชำระเงินค่ะ',
  ].join('\n');
}
