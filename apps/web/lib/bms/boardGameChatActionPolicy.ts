import { createHash, randomUUID } from "node:crypto";
import type { ExecCtx, ToolResult } from "./tools/types";

export const BOARD_GAME_CHAT_ACTIONS = ["CANCEL", "RESCHEDULE", "REFUND", "EXTEND_TIME", "DISCOUNT", "STAFF"] as const;
export type BoardGameChatAction = typeof BOARD_GAME_CHAT_ACTIONS[number];
export type BoardGameChatActionDraft = {
  action: BoardGameChatAction; reference?: string; reservedLocal?: string;
  durationMinutes?: number; partySize?: number; note?: string;
};
export type BoardGameChatActionPreview = {
  action: BoardGameChatAction; reference: string | null; branch: string | null;
  reservedFor: string | null; timezone: string; durationMinutes: number | null; partySize: number | null;
  note: string | null; version: string;
};
export type BoardGameChatActionQuote = {
  draft: BoardGameChatActionDraft; preview: BoardGameChatActionPreview;
  fingerprint: string; expiresAt: number; requestKey: string;
};
export type BoardGameChatActionResult = { action: BoardGameChatAction; reference: string; status: "CANCELLED" | "CONFIRMED" | "STAFF_REVIEW" };
const labels: Record<BoardGameChatAction, [string, string]> = {
  CANCEL: ["ยกเลิกการจอง", "Cancel booking"], RESCHEDULE: ["เลื่อนการจอง", "Reschedule booking"],
  REFUND: ["ขอคืนเงิน", "Request refund"], EXTEND_TIME: ["ขอต่อเวลา", "Request extra play time"],
  DISCOUNT: ["ขอส่วนลด", "Request discount"], STAFF: ["เรียกพนักงาน", "Contact staff"],
};
export function boardGameChatActionFingerprint(preview: BoardGameChatActionPreview, customerId: string) {
  return createHash("sha256").update(JSON.stringify([customerId, preview])).digest("hex");
}
export function boardGameChatActionSummary(quote: BoardGameChatActionQuote, english: boolean) {
  const p = quote.preview;
  const details = [labels[p.action][english ? 1 : 0], p.reference && `#${p.reference}`, p.branch,
    p.reservedFor && `${new Date(p.reservedFor).toLocaleString(english ? "en-GB" : "th-TH", { timeZone: p.timezone })} (${p.timezone})`,
    p.durationMinutes && `${p.durationMinutes} ${english ? "minutes" : "นาที"}`,
    p.partySize && `${p.partySize} ${english ? "people" : "คน"}`, p.note].filter(Boolean).join(" · ");
  const review = !["CANCEL", "RESCHEDULE"].includes(p.action);
  return english
    ? `Please confirm: ${details}. ${review ? "This sends a request to staff; money, prices and play time change only after staff approval. " : "No money will be refunded by this action. "}Reply yes to submit.`
    : `กรุณาตรวจรายการ: ${details} ${review ? "ส่งคำขอให้พนักงานพิจารณา เงิน ราคา และเวลาเล่นจะเปลี่ยนเมื่อพนักงานอนุมัติเท่านั้น" : "รายการนี้ไม่มีการคืนเงิน"} ตอบตกลงเพื่อดำเนินการค่ะ`;
}
export function isLatestBoardGameChatActionSummary(quote: BoardGameChatActionQuote, lastAssistant: string) {
  return [false, true].some(english => boardGameChatActionSummary(quote, english).trim() === lastAssistant.trim());
}
export function boardGameChatActionReceipt(result: BoardGameChatActionResult, english: boolean) {
  if (result.status === "CANCELLED") return english
    ? `Booking #${result.reference} has been cancelled. No refund was made.`
    : `ยกเลิกการจอง #${result.reference} แล้วค่ะ รายการนี้ไม่มีการคืนเงินค่ะ`;
  if (result.status === "CONFIRMED") return english
    ? `Booking #${result.reference} has been rescheduled and the new time is confirmed.`
    : `เลื่อนการจอง #${result.reference} สำเร็จ และยืนยันช่วงเวลาใหม่แล้วค่ะ`;
  return english
    ? `${labels[result.action][1]} #${result.reference} has been added to the staff Inbox and mentions queue. Please wait for staff review; no refund, discount or time change has been applied.`
    : `ส่งคำขอ${labels[result.action][0]} #${result.reference} เข้าคิว Inbox และเมนชันของพนักงานแล้วค่ะ กรุณารอพนักงานพิจารณา ยังไม่ได้คืนเงิน ลดราคา หรือเปลี่ยนเวลาเล่นค่ะ`;
}
export function boardGameChatActionFailure(error: string | undefined, english: boolean) {
  const code = error?.split(":", 1)[0];
  const replies: Record<string, [string, string]> = {
    NO_TABLE_AVAILABLE: ["ช่วงเวลาหรือจำนวนคนนี้ไม่มีโต๊ะรองรับ การจองเดิมยังไม่เปลี่ยน กรุณาเลือกเวลาใหม่ค่ะ", "No table fits that time or party size. Any existing booking is unchanged. Please choose another time."],
    BOOKING_NOT_FOUND: ["ไม่พบการจองของคุณจากรหัสนี้ กรุณาตรวจสถานะและเลือกรหัสการจองอีกครั้งค่ะ", "That booking was not found for your account. Please check your booking status and select its reference."],
    CONFIRMATION_REQUIRED: ["รายละเอียดเปลี่ยนแล้ว กรุณาขอสรุปใหม่และยืนยันอีกครั้งค่ะ", "The details changed. Please review and confirm a new summary."],
    BOOKING_STATE_CHANGED: ["สถานะการจองเปลี่ยนแล้ว กรุณาตรวจสถานะล่าสุดก่อนค่ะ", "The booking state changed. Please check its current status."],
    STAFF_UNAVAILABLE: ["ยังไม่มีพนักงานรับคำขอในระบบ ยังไม่ได้ส่งคำขอ กรุณาติดต่อร้านโดยตรงค่ะ", "No staff recipient is configured. The request was not sent; please contact the shop directly."],
    DEPOSIT_REQUIRES_STAFF: ["รายการที่มีมัดจำต้องให้พนักงานตรวจสอบ กรุณาติดต่อร้านค่ะ", "Bookings with a deposit require staff review. Please contact the shop."],
  };
  return replies[code ?? ""]?.[english ? 1 : 0] ?? (english
    ? "The action could not be verified. Please check your booking status or contact the shop."
    : "ยังยืนยันผลรายการไม่ได้ กรุณาตรวจสถานะการจองหรือติดต่อร้านค่ะ");
}
export async function executeBoardGameChatAction(draft: BoardGameChatActionDraft, ec: ExecCtx, deps: {
  resolveCustomer: () => Promise<string | null>;
  preview: (customerId: string, draft: BoardGameChatActionDraft) => Promise<BoardGameChatActionPreview>;
  commit: (customerId: string, quote: BoardGameChatActionQuote) => Promise<BoardGameChatActionResult>;
}): Promise<ToolResult> {
  if (!ec.channel || !ec.customerRef) return { ok: false, error: "CUSTOMER_IDENTITY_REQUIRED" };
  const customerId = await deps.resolveCustomer();
  if (!customerId) return { ok: false, error: "CUSTOMER_IDENTITY_REQUIRED" };
  const confirmed = ec.confirmedBoardGameChatAction;
  // Only the pipeline supplies the immutable draft after consuming the saved summary.
  if (confirmed && confirmed.expiresAt > Date.now() && JSON.stringify(confirmed.draft) === JSON.stringify(draft)) {
    ec.boardGameChatActionResult = await deps.commit(customerId, confirmed);
    ec.pendingBoardGameChatAction = undefined;
    return { ok: true, data: ec.boardGameChatActionResult };
  }
  const preview = await deps.preview(customerId, draft);
  ec.pendingBoardGameChatAction = {
    draft, preview, fingerprint: boardGameChatActionFingerprint(preview, customerId),
    expiresAt: Date.now() + 15 * 60_000, requestKey: randomUUID(),
  };
  const { version: _version, ...safePreview } = preview;
  return { ok: true, data: { status: "CONFIRMATION_REQUIRED", ...safePreview } };
}
