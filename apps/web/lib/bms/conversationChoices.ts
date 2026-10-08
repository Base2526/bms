import { createHash, randomUUID } from "node:crypto";

export const CONVERSATION_CHOICE_TTL_MS = 15 * 60_000;

export type ConversationChoiceKind =
  | "INPUT_SELECTION"
  | "CATALOG_SELECTION"
  | "STOCK_SELECTION"
  | "PHARMACY_INPUT"
  | "PHARMACY_CHECKOUT"
  | "ORDER_CONFIRMATION"
  | "RESTAURANT_REQUEST_CONFIRMATION"
  | "BOARD_GAME_RESERVATION_CONFIRMATION"
  | "BOARD_GAME_ACTION_CONFIRMATION"
  | "BOARD_GAME_BOOKING_SELECTION"
  | "BOARD_GAME_BOOKING_ACTION";

export type ConversationChoiceValue =
  | "INPUT"
  | "CONFIRM"
  | "EDIT"
  | "KEEP"
  | "SELECT_BOOKING"
  | "CANCEL_BOOKING"
  | "RESCHEDULE_BOOKING";

export type ConversationChoiceBooking = {
  reference: string;
  branch: string;
  status: string;
  reservedFor: string;
  timezone: string;
  durationMinutes: number;
  partySize: number;
};

export type ConversationChoiceOption = {
  code: string;
  value: ConversationChoiceValue;
  label: string;
  booking?: ConversationChoiceBooking;
  replyText?: string;
  stockAction?:
    | { action: "CHECK" | "RESTOCK"; sku: string; size?: string; offset?: number }
    | { action: "REVISE"; items: Array<{ sku: string; size: string; qty: number; packCode?: string }> };
};

export type PendingConversationChoice = {
  version: 1;
  id?: string;
  consumed?: boolean;
  kind: ConversationChoiceKind;
  promptHash: string;
  expiresAt: number;
  options: ConversationChoiceOption[];
  context?: { caseId: string; stage: string; questionKey?: string | null };
};

export type ConversationChoiceResolution =
  | { kind: "none" | "not_choice" | "stale" | "expired" }
  | { kind: "invalid"; pending: PendingConversationChoice }
  | { kind: "matched"; pending: PendingConversationChoice; option: ConversationChoiceOption };

function promptHash(prompt: string): string {
  return createHash("sha256").update(prompt.trim()).digest("hex");
}

export function conversationReplyCode(message: string): string | null {
  const normalized = message.trim().replace(/[๐-๙]/g, digit => String(digit.charCodeAt(0) - 0x0e50));
  const match = normalized.match(
    /^(?:(?:เลือก|choice|option)\s*)?(?:ข้อ\s*)?(\d+)[.)]?(?:\s*(?:ค่ะ|คะ|ครับ|นะ|เลย|please))*[.!🙏]*$/i
  );
  return match?.[1] ?? null;
}

export function confirmationChoiceOptions(english = false): ConversationChoiceOption[] {
  return [
    { code: "1", value: "CONFIRM", label: english ? "Confirm" : "ยืนยัน" },
    { code: "2", value: "EDIT", label: english ? "Edit / go back" : "แก้ไข / กลับ" },
  ];
}

export function createPendingConversationChoice(input: {
  kind: ConversationChoiceKind;
  prompt: string;
  options: ConversationChoiceOption[];
  now?: number;
  ttlMs?: number;
  context?: PendingConversationChoice["context"];
}): PendingConversationChoice {
  if (input.options.length < 1 || input.options.length > 9) {
    throw new Error("conversation choice must have 1-9 options");
  }
  const codes = input.options.map(option => option.code);
  if (new Set(codes).size !== codes.length || codes.some(code => !/^[1-9]$/.test(code))) {
    throw new Error("conversation choice codes must be unique digits 1-9");
  }
  return {
    version: 1,
    id: randomUUID(),
    kind: input.kind,
    promptHash: promptHash(input.prompt),
    expiresAt: (input.now ?? Date.now()) + (input.ttlMs ?? CONVERSATION_CHOICE_TTL_MS),
    options: input.options,
    ...(input.context ? { context: input.context } : {}),
  };
}

export function isConversationChoicePromptCurrent(
  pending: PendingConversationChoice | null | undefined,
  latestAssistantMessage: string,
  now = Date.now()
): boolean {
  return Boolean(
    pending &&
    pending.version === 1 &&
    !pending.consumed &&
    pending.expiresAt > now &&
    latestAssistantMessage.trim() &&
    promptHash(latestAssistantMessage) === pending.promptHash
  );
}

export function resolveConversationChoice(
  pending: PendingConversationChoice | null | undefined,
  message: string,
  latestAssistantMessage: string,
  now = Date.now()
): ConversationChoiceResolution {
  if (!pending) return { kind: "none" };
  const code = conversationReplyCode(message);
  if (!code) return { kind: "not_choice" };
  if (pending.version !== 1 || pending.expiresAt <= now) return { kind: "expired" };
  if (!isConversationChoicePromptCurrent(pending, latestAssistantMessage, now)) {
    return { kind: "stale" };
  }
  const option = pending.options.find(candidate => candidate.code === code);
  return option ? { kind: "matched", pending, option } : { kind: "invalid", pending };
}

export function inputChoiceOptions(labels: string[]): ConversationChoiceOption[] {
  return labels.map((label, index) => ({ code: String(index + 1), value: "INPUT", label, replyText: label }));
}

export function renderConversationChoices(question: string, options: ConversationChoiceOption[]): string {
  return `${question.trim()}\n${options.map(option => `${option.code}. ${option.label}`).join("\n")}`;
}
