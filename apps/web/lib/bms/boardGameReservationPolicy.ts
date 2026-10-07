import { createHash } from "node:crypto";
import type { ExecCtx, ToolResult } from "./tools/types";

export type BoardGameReservationDraft = {
  branch: string; reservedLocal: string; durationMinutes: number; partySize: number; note?: string;
};
export type BoardGameReservationPreview = BoardGameReservationDraft & {
  locationId: string; reservedFor: string; timezone: string;
};
export type BoardGameReservationQuote = {
  draft: BoardGameReservationDraft; preview: BoardGameReservationPreview; fingerprint: string; expiresAt: number;
};
export function isBoardGameReservationConfirmation(message: string) {
  return /^(?:ตกลง|ยืนยัน|เอาตามนี้|yes(?: please)?|confirm)(?:\s*(?:ค่ะ|คะ|ครับ|นะ|เลย))*[.!🙏]*$/i.test(message.trim());
}
export function boardGameReservationFingerprint(preview: BoardGameReservationPreview, customerId: string) {
  return createHash("sha256").update(JSON.stringify([
    customerId, preview.locationId, preview.branch, preview.reservedLocal, preview.reservedFor,
    preview.timezone, preview.durationMinutes, preview.partySize, preview.note ?? "",
  ])).digest("hex");
}
export function boardGameReservationSummary(quote: BoardGameReservationQuote, english: boolean) {
  const p = quote.preview;
  const when = new Date(p.reservedFor).toLocaleString(english ? "en-GB" : "th-TH", { timeZone: p.timezone });
  return english
    ? `Please confirm this table request: ${p.branch}, ${when} (${p.timezone}), ${p.durationMinutes} minutes, ${p.partySize} people.${p.note ? ` Note: ${p.note}.` : ""} This is a request for staff review, not a confirmed table. Reply yes to submit.`
    : `กรุณาตรวจคำขอจองโต๊ะ: ${p.branch} วันที่ ${when} (${p.timezone}) ระยะเวลา ${p.durationMinutes} นาที จำนวน ${p.partySize} คน${p.note ? ` หมายเหตุ: ${p.note}` : ""} นี่เป็นคำขอ ร้านต้องยืนยันก่อน ยังไม่ได้ยืนยันโต๊ะ ตอบตกลงเพื่อส่งคำขอค่ะ`;
}
/** A saved quote is not consent after an intervening reply (including an emergency fast path). */
export function isLatestBoardGameReservationSummary(quote: BoardGameReservationQuote, lastAssistant: string) {
  return [false, true].some(english => boardGameReservationSummary(quote, english).trim() === lastAssistant.trim());
}
export function boardGameReservationReceipt(id: string, english: boolean) {
  return english
    ? `Booking request #${id.slice(0, 8)} was sent for staff review. No table is confirmed yet. Please wait for the shop to contact you or ask for its status in this chat.`
    : `ส่งคำขอจองโต๊ะ #${id.slice(0, 8)} ให้ร้านตรวจแล้วค่ะ ตอนนี้ยังไม่ได้ยืนยันโต๊ะ กรุณารอร้านติดต่อกลับหรือสอบถามสถานะในแชทนี้ได้ค่ะ`;
}
export function boardGameReservationStatusReply(
  requests: Array<{ reference: string; branch: string; status: string; reservedFor: string | null; timezone: string; partySize: number; rejectionReason: string | null }>,
  english: boolean
) {
  if (!requests.length) return english ? "No chat booking requests were found for you." : "ไม่พบคำขอจองจากแชทของคุณค่ะ";
  const labels: Record<string, [string, string]> = {
    REQUESTED: ["รอร้านตรวจ ยังไม่ได้ยืนยันโต๊ะ", "Awaiting staff review; no table is confirmed"],
    CONFIRMED: ["ร้านยืนยันวันเวลาจองแล้ว", "The shop has confirmed the booking time"],
    REJECTED: ["ร้านปฏิเสธคำขอ", "The shop rejected the request"],
    EXPIRED: ["คำขอหมดอายุ", "Request expired"], CANCELLED: ["ยกเลิกแล้ว", "Cancelled"],
    NO_SHOW: ["ไม่มาตามนัด", "No show"], WAITING: ["เช็คอินแล้ว รอเรียก", "Checked in, waiting"],
    CALLED: ["ร้านเรียกแล้ว", "Called by staff"], SEATED: ["เข้านั่งแล้ว", "Seated"],
  };
  return requests.map(r => {
    const when = r.reservedFor ? new Date(r.reservedFor).toLocaleString(english ? "en-GB" : "th-TH", { timeZone: r.timezone }) : "";
    return `#${r.reference} · ${r.branch} · ${when} (${r.timezone}) · ${r.partySize} ${english ? "people" : "คน"} · ${labels[r.status]?.[english ? 1 : 0] ?? (english ? "Please contact staff" : "กรุณาติดต่อร้าน")}${r.status === "REJECTED" && r.rejectionReason ? ` · ${english ? "Reason from shop" : "เหตุผลจากร้าน"}: ${r.rejectionReason.slice(0, 300)}` : ""}`;
  }).join("\n");
}

export type BoardGameReservationDeps = {
  resolveCustomer: () => Promise<string | null>;
  contact: () => Promise<{ hasRecipientName: boolean; hasPhone: boolean }>;
  preview: (draft: BoardGameReservationDraft) => Promise<BoardGameReservationPreview>;
  create: (input: BoardGameReservationPreview & { customerId: string; requestKey: string; expectedFingerprint: string }) => Promise<{ requestId: string; status: string }>;
};
export async function executeBoardGameReservationRequest(
  draft: BoardGameReservationDraft, ec: ExecCtx, deps: BoardGameReservationDeps
): Promise<ToolResult> {
  if (!ec.channel || !ec.customerRef) return { ok: false, error: "CUSTOMER_IDENTITY_REQUIRED" };
  const customerId = await deps.resolveCustomer();
  if (!customerId) return { ok: false, error: "CONTACT_REQUIRED: recipientName, phone" };
  const contact = await deps.contact();
  const missing = [!contact.hasRecipientName && "recipientName", !contact.hasPhone && "phone"].filter(Boolean);
  if (missing.length) return { ok: false, error: `CONTACT_REQUIRED: ${missing.join(", ")}; use save_customer_checkout_details` };
  const preview = await deps.preview(draft);
  const fingerprint = boardGameReservationFingerprint(preview, customerId);
  const confirmed = ec.confirmedBoardGameReservation;
  if (!confirmed || confirmed.fingerprint !== fingerprint || confirmed.expiresAt <= Date.now()) {
    const quote = { draft: { ...draft, branch: preview.branch }, preview, fingerprint, expiresAt: Date.now() + 15 * 60_000 };
    ec.pendingBoardGameReservation = quote;
    return { ok: true, data: { status: "CONFIRMATION_REQUIRED",
      branch: preview.branch, reservedLocal: preview.reservedLocal, timezone: preview.timezone,
      durationMinutes: preview.durationMinutes, partySize: preview.partySize, note: preview.note ?? null,
      notice: "Request only; staff must confirm. No table is confirmed." } };
  }
  const created = await deps.create({ ...preview, customerId,
    requestKey: `${ec.conversationId ?? `${ec.channel}:${customerId}`}:${fingerprint}`, expectedFingerprint: fingerprint });
  ec.boardGameReservationRequestId = created.requestId;
  ec.pendingBoardGameReservation = undefined;
  return { ok: true, data: { requestReference: created.requestId.slice(0, 8), status: created.status } };
}
