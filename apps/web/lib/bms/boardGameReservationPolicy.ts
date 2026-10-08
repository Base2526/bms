import { createHash, randomUUID } from "node:crypto";
import type { ExecCtx, ToolResult } from "./tools/types";
import type { ConversationChoiceBooking, ConversationChoiceKind, ConversationChoiceOption } from "./conversationChoices";

export type BoardGameReservationDraft = {
  branch: string; reservedLocal: string; durationMinutes: number; partySize: number; note?: string;
};
export type BoardGameReservationPreview = BoardGameReservationDraft & {
  locationId: string; reservedFor: string; timezone: string; autoConfirm?: boolean;
};
export type BoardGameReservationQuote = {
  draft: BoardGameReservationDraft; preview: BoardGameReservationPreview; fingerprint: string; expiresAt: number; requestKey?: string;
};
export function isBoardGameReservationConfirmation(message: string) {
  return /^(?:ตกลง|ยืนยัน|เอาตามนี้|yes(?: please)?|confirm)(?:\s*(?:ค่ะ|คะ|ครับ|นะ|เลย))*[.!🙏]*$/i.test(message.trim());
}
export function boardGameReservationFingerprint(preview: BoardGameReservationPreview, customerId: string) {
  return createHash("sha256").update(JSON.stringify([
    customerId, preview.locationId, preview.branch, preview.reservedLocal, preview.reservedFor,
    preview.timezone, preview.durationMinutes, preview.partySize, preview.note ?? "", preview.autoConfirm === true,
  ])).digest("hex");
}
export function boardGameReservationSummary(quote: BoardGameReservationQuote, english: boolean) {
  const p = quote.preview;
  const when = new Date(p.reservedFor).toLocaleString(english ? "en-GB" : "th-TH", { timeZone: p.timezone });
  if (p.autoConfirm) return english
    ? `Please confirm this booking: ${p.branch}, ${when} (${p.timezone}), ${p.durationMinutes} minutes, ${p.partySize} people.${p.note ? ` Note: ${p.note}.` : ""} The shop allows automatic confirmation subject to a fresh table availability check. No deposit.\n1. Confirm booking\n2. Edit booking`
    : `กรุณาตรวจการจอง: ${p.branch} วันที่ ${when} (${p.timezone}) ระยะเวลา ${p.durationMinutes} นาที จำนวน ${p.partySize} คน${p.note ? ` หมายเหตุ: ${p.note}` : ""} ร้านเปิดยืนยันอัตโนมัติโดยตรวจโต๊ะว่างอีกครั้ง ไม่มีมัดจำ\n1. ยืนยันการจอง\n2. แก้ไขการจอง`;
  return english
    ? `Please confirm this table request: ${p.branch}, ${when} (${p.timezone}), ${p.durationMinutes} minutes, ${p.partySize} people.${p.note ? ` Note: ${p.note}.` : ""} This is a request for staff review, not a confirmed table.\n1. Submit request\n2. Edit request`
    : `กรุณาตรวจคำขอจองโต๊ะ: ${p.branch} วันที่ ${when} (${p.timezone}) ระยะเวลา ${p.durationMinutes} นาที จำนวน ${p.partySize} คน${p.note ? ` หมายเหตุ: ${p.note}` : ""} นี่เป็นคำขอ ร้านต้องยืนยันก่อน ยังไม่ได้ยืนยันโต๊ะ\n1. ยืนยันส่งคำขอ\n2. แก้ไขคำขอ`;
}
/** A saved quote is not consent after an intervening reply (including an emergency fast path). */
export function isLatestBoardGameReservationSummary(quote: BoardGameReservationQuote, lastAssistant: string) {
  return [false, true].some(english => boardGameReservationSummary(quote, english).trim() === lastAssistant.trim());
}
export function boardGameReservationReceipt(id: string, english: boolean, status = "REQUESTED") {
  if (status === "CONFIRMED") return english
    ? `Booking #${id.slice(0, 8)} is confirmed. A table has been reserved for the confirmed time and party size.`
    : `จองสำเร็จแล้วค่ะ #${id.slice(0, 8)} ระบบยืนยันโต๊ะตามวันเวลาและจำนวนคนที่คุณยืนยันแล้วค่ะ`;
  if (status !== "REQUESTED") return english
    ? `Booking #${id.slice(0, 8)} has changed. Please check its current status in this chat.`
    : `การจอง #${id.slice(0, 8)} เปลี่ยนสถานะแล้ว กรุณาตรวจสถานะล่าสุดในแชทค่ะ`;
  return english
    ? `Booking request #${id.slice(0, 8)} was sent for staff review. No table is confirmed yet. Please wait for the shop to contact you or ask for its status in this chat.`
    : `ส่งคำขอจองโต๊ะ #${id.slice(0, 8)} ให้ร้านตรวจแล้วค่ะ ตอนนี้ยังไม่ได้ยืนยันโต๊ะ กรุณารอร้านติดต่อกลับหรือสอบถามสถานะในแชทนี้ได้ค่ะ`;
}
export type BoardGameReservationStatus = {
  reference: string; branch: string; status: string; reservedFor: string | null; timezone: string;
  durationMinutes: number; partySize: number; rejectionReason: string | null;
};

export function boardGameReservationStatusReply(
  requests: BoardGameReservationStatus[],
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

export type BoardGameReservationMenu = {
  reply: string;
  kind: ConversationChoiceKind | null;
  options: ConversationChoiceOption[];
};

function choiceBooking(request: BoardGameReservationStatus): ConversationChoiceBooking | null {
  if (!request.reservedFor) return null;
  return {
    reference: request.reference,
    branch: request.branch,
    status: request.status,
    reservedFor: request.reservedFor,
    timezone: request.timezone,
    durationMinutes: request.durationMinutes,
    partySize: request.partySize,
  };
}

function durationLabel(minutes: number, english: boolean): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return english ? `${hours} hour${hours === 1 ? "" : "s"}` : `${hours} ชั่วโมง`;
  }
  return `${minutes} ${english ? "minutes" : "นาที"}`;
}

export function boardGameBookingActionMenu(
  booking: ConversationChoiceBooking,
  english: boolean
): BoardGameReservationMenu {
  const options: ConversationChoiceOption[] = [
    { code: "1", value: "CANCEL_BOOKING", label: english ? "Cancel this booking" : "ยกเลิกการจอง", booking },
  ];
  if (booking.status === "CONFIRMED") {
    options.push({ code: "2", value: "RESCHEDULE_BOOKING", label: english ? "Change date or time" : "เลื่อนวันเวลา", booking });
  }
  options.push({
    code: String(options.length + 1), value: "KEEP",
    label: english ? "Keep this booking" : "คงการจองเดิม", booking,
  });
  const when = new Date(booking.reservedFor).toLocaleString(english ? "en-GB" : "th-TH", { timeZone: booking.timezone });
  const status = booking.status === "CONFIRMED"
    ? (english ? "confirmed" : "ยืนยันแล้ว")
    : (english ? "awaiting shop review" : "รอร้านตรวจ");
  const heading = english
    ? `Your booking #${booking.reference}: ${booking.branch} / ${when} / ${booking.partySize} people / ${durationLabel(booking.durationMinutes, true)} · ${status}`
    : `การจองของคุณ #${booking.reference}: ${booking.branch} / ${when} / ${booking.partySize} คน / ${durationLabel(booking.durationMinutes, false)} · ${status}`;
  const menu = [heading, ...options.map(option => `${option.code}. ${option.label}`)].join("\n");
  return { reply: menu, kind: "BOARD_GAME_BOOKING_ACTION", options };
}

export function boardGameReservationStatusMenu(
  requests: BoardGameReservationStatus[],
  english: boolean
): BoardGameReservationMenu {
  const status = boardGameReservationStatusReply(requests, english);
  const active = requests
    .filter(request => ["REQUESTED", "CONFIRMED"].includes(request.status))
    .map(choiceBooking)
    .filter((booking): booking is ConversationChoiceBooking => Boolean(booking));
  if (!active.length) return { reply: status, kind: null, options: [] };
  if (active.length === 1) return boardGameBookingActionMenu(active[0], english);

  const options: ConversationChoiceOption[] = active.map((booking, index) => ({
    code: String(index + 1), value: "SELECT_BOOKING", booking,
    label: english
      ? `#${booking.reference} · ${booking.branch} · ${new Date(booking.reservedFor).toLocaleString("en-GB", { timeZone: booking.timezone })}`
      : `#${booking.reference} · ${booking.branch} · ${new Date(booking.reservedFor).toLocaleString("th-TH", { timeZone: booking.timezone })}`,
  }));
  options.push({
    code: String(options.length + 1), value: "KEEP",
    label: english ? "Do not change any booking" : "ไม่เปลี่ยนแปลงการจอง",
  });
  const heading = english ? "Choose the booking you want to manage:" : "เลือกการจองที่ต้องการจัดการ:";
  return {
    reply: `${status}\n\n${heading}\n${options.map(option => `${option.code}. ${option.label}`).join("\n")}`,
    kind: "BOARD_GAME_BOOKING_SELECTION",
    options,
  };
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
    const quote = { draft: { ...draft, branch: preview.branch }, preview, fingerprint, expiresAt: Date.now() + 15 * 60_000, requestKey: randomUUID() };
    ec.pendingBoardGameReservation = quote;
    return { ok: true, data: { status: "CONFIRMATION_REQUIRED",
      branch: preview.branch, reservedLocal: preview.reservedLocal, timezone: preview.timezone,
      durationMinutes: preview.durationMinutes, partySize: preview.partySize, note: preview.note ?? null,
      notice: preview.autoConfirm
        ? "After customer confirmation the backend will allocate a table if available. No booking has been made yet."
        : "Request only; staff must confirm. No table is confirmed." } };
  }
  const created = await deps.create({ ...preview, customerId,
    requestKey: confirmed.requestKey ?? `${ec.conversationId ?? `${ec.channel}:${customerId}`}:${fingerprint}`, expectedFingerprint: fingerprint });
  ec.boardGameReservationRequestId = created.requestId;
  ec.boardGameReservationResultStatus = created.status;
  ec.pendingBoardGameReservation = undefined;
  return { ok: true, data: { requestReference: created.requestId.slice(0, 8), status: created.status } };
}
