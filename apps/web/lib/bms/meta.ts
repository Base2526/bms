// =============================================================
// BMS Meta (Facebook Messenger / Instagram) webhook helpers
// -------------------------------------------------------------
// FB Messenger + IG DM ใช้ Messenger Platform เดียวกัน (graph.facebook.com)
//   • GET  = verification (hub.challenge)
//   • POST = events { object, entry[].messaging[] }
// signature = X-Hub-Signature-256 (HMAC-SHA256 ด้วย App Secret) — verify ใน route
// =============================================================

import type { ChannelConfig } from "./channels";
import { createHash } from "node:crypto";

// These buttons start a conversation; they never authorize checkout, payment or other writes.
const STARTER_MESSAGES: Readonly<Record<string, string>> = {
  BMS_CHAT_PRICE: "ขอทราบราคา",
  BMS_CHAT_DETAILS: "ขอรายละเอียดสินค้าและบริการ",
  BMS_CHAT_INTERESTED: "สนใจซื้อ ขอทราบขั้นตอนและรายละเอียดก่อนตัดสินใจ",
  BMS_CHAT_START: "สวัสดี ขอข้อมูลสินค้าและบริการ",
};

/** Verify the separate webhook handshake credential. */
export function metaChallenge(url: URL, cfg: ChannelConfig | null): string | null {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode !== "subscribe" || !challenge) return null;
  // Verify Token is a revocable handshake credential, not the App Secret used to sign POSTs.
  // Fail closed when the channel has not been configured; accepting any token lets a typo or
  // stale tenant URL appear successfully registered in Meta.
  if (!cfg?.webhook_verify_token || token !== cfg.webhook_verify_token) return null;
  return challenge;
}

export type MetaEvent = {
  externalAccountId: string;
  senderId: string;
  text: string;
  eventId: string;
  attachments: Array<{ type: string | null; url: string | null; title?: string | null; mimeType?: string | null }>;
  meta: MetaInboundContext;
};

export type MetaInboundContext = {
  replyToMessageId?: string;
  quickReplyPayload?: string;
  postbackPayload?: string;
  referral?: { source?: string; type?: string; ref?: string; adId?: string };
};

export type MetaInboxSignal =
  | { kind: "ECHO"; externalAccountId: string; customerRef: string; providerMessageId: string;
      text: string; attachments: MetaEvent["attachments"]; occurredAt: number }
  | { kind: "DELIVERY"; externalAccountId: string; customerRef: string;
      providerMessageIds: string[]; occurredAt: number }
  | { kind: "READ"; externalAccountId: string; customerRef: string; occurredAt: number };

function boundedString(value: unknown, max = 500): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

function attachmentList(message: any): MetaEvent["attachments"] {
  return Array.isArray(message?.attachments)
    ? message.attachments.slice(0, 10).map((att: any) => ({
      type: boundedString(att?.type, 40) ?? null,
      url: boundedString(att?.payload?.url, 2_000) ?? null,
      title: boundedString(att?.title, 255) ?? null,
      mimeType: boundedString(att?.mime_type, 120) ?? null,
    }))
    : [];
}

function referralContext(value: any): MetaInboundContext["referral"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const referral = {
    source: boundedString(value.source, 80),
    type: boundedString(value.type, 80),
    ref: boundedString(value.ref, 500),
    adId: boundedString(value.ad_id, 100),
  };
  return Object.values(referral).some(Boolean) ? referral : undefined;
}

function inboundContext(message: any, referral: any): MetaInboundContext {
  const context: MetaInboundContext = {};
  const replyToMessageId = boundedString(message?.reply_to?.mid, 500);
  const quickReplyPayload = boundedString(message?.quick_reply?.payload);
  const parsedReferral = referralContext(referral);
  if (replyToMessageId) context.replyToMessageId = replyToMessageId;
  if (quickReplyPayload) context.quickReplyPayload = quickReplyPayload;
  if (parsedReferral) context.referral = parsedReferral;
  return context;
}

export function metaEnvelopeMatches(
  body: any,
  expectedExternalAccountId: string,
  expectedObject: "page" | "instagram" = "page",
): boolean {
  if (body?.object !== expectedObject || !expectedExternalAccountId) return false;
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  return entries.length > 0 && entries.every((entry: any) =>
    typeof entry?.id === "string" && entry.id.trim() === expectedExternalAccountId);
}

/** แกะข้อความและ attachment จาก payload (รองรับทั้ง Messenger และ IG) */
export function parseMetaEvents(
  body: any,
  expectedExternalAccountId: string,
  expectedObject: "page" | "instagram" = "page",
): MetaEvent[] {
  const out: MetaEvent[] = [];
  if (!metaEnvelopeMatches(body, expectedExternalAccountId, expectedObject)) return out;
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const externalAccountId = typeof entry?.id === "string" ? entry.id.trim() : "";
    // The callback URL contains a tenant id, but that URL is not authority. Bind every event to
    // the provider-owned Page ID saved for this tenant so a shared App Secret cannot replay one
    // Page's signed payload into another tenant URL.
    if (!externalAccountId || externalAccountId !== expectedExternalAccountId) continue;
    const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];
    for (const ev of messaging) {
      const senderId = ev?.sender?.id;
      if (expectedObject === "page" && ev?.postback && !ev?.message) {
        const payload = ev.postback.payload;
        const text = typeof payload === "string" && Object.hasOwn(STARTER_MESSAGES, payload)
          ? STARTER_MESSAGES[payload] : null;
        const timestamp = ev.timestamp;
        if (!text || typeof senderId !== "string" || !/^\d{5,64}$/.test(senderId) ||
            !Number.isSafeInteger(timestamp) || timestamp <= 0 ||
            ev?.recipient?.id !== externalAccountId) continue;
        // Some postbacks have no mid. The provider timestamp makes retries stable while
        // allowing the same customer to press the same button again later.
        const eventId = `postback:${createHash("sha256").update(JSON.stringify([
          externalAccountId, senderId, timestamp, payload,
        ])).digest("hex")}`;
        out.push({
          externalAccountId, senderId, text, eventId, attachments: [],
          meta: {
            ...(boundedString(payload) ? { postbackPayload: boundedString(payload) } : {}),
            ...(referralContext(ev.postback.referral ?? ev.referral)
              ? { referral: referralContext(ev.postback.referral ?? ev.referral) } : {}),
          },
        });
        continue;
      }
      const eventId = typeof ev?.message?.mid === "string" ? ev.message.mid.trim() : "";
      const text = typeof ev?.message?.text === "string" ? ev.message.text.trim() : "";
      const attachments = attachmentList(ev?.message);
      // ข้าม echo (ข้อความที่เพจ/บัญชีส่งเอง) และ event ที่ไม่มีเนื้อหาให้ทีมเห็น
      if (typeof senderId === "string" && /^\d{5,64}$/.test(senderId) && eventId && !ev?.message?.is_echo && (text || attachments.length > 0)) {
        out.push({
          externalAccountId,
          senderId,
          text,
          attachments,
          eventId,
          meta: inboundContext(ev?.message, ev?.referral),
        });
      }
    }
  }
  return out;
}

/** Parse non-customer-turn events. They update Inbox state but must never enter the AI pipeline. */
export function parseMetaInboxSignals(
  body: any,
  expectedExternalAccountId: string,
  expectedObject: "page" | "instagram" = "page",
): MetaInboxSignal[] {
  if (!metaEnvelopeMatches(body, expectedExternalAccountId, expectedObject)) return [];
  const signals: MetaInboxSignal[] = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    const externalAccountId = boundedString(entry?.id, 64);
    if (externalAccountId !== expectedExternalAccountId) continue;
    for (const ev of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      const senderId = boundedString(ev?.sender?.id, 64);
      const recipientId = boundedString(ev?.recipient?.id, 64);
      if (ev?.message?.is_echo === true && senderId === externalAccountId && /^\d{5,64}$/.test(recipientId ?? "")) {
        const providerMessageId = boundedString(ev.message.mid, 500);
        const occurredAt = Number(ev.timestamp);
        const text = boundedString(ev.message.text, 20_000) ?? "";
        const attachments = attachmentList(ev.message);
        if (providerMessageId && Number.isSafeInteger(occurredAt) && occurredAt > 0 && (text || attachments.length)) {
          signals.push({ kind: "ECHO", externalAccountId, customerRef: recipientId!, providerMessageId,
            text, attachments, occurredAt });
        }
        continue;
      }
      if (!/^\d{5,64}$/.test(senderId ?? "") || recipientId !== externalAccountId) continue;
      if (ev?.delivery) {
        const occurredAt = Number(ev.delivery.watermark ?? ev.timestamp);
        const providerMessageIds = Array.isArray(ev.delivery.mids)
          ? ev.delivery.mids.map((mid: unknown) => boundedString(mid, 500)).filter((mid: any): mid is string => Boolean(mid)).slice(0, 100)
          : [];
        if (Number.isSafeInteger(occurredAt) && occurredAt > 0) {
          signals.push({ kind: "DELIVERY", externalAccountId, customerRef: senderId!, providerMessageIds, occurredAt });
        }
      } else if (ev?.read) {
        const occurredAt = Number(ev.read.watermark ?? ev.timestamp);
        if (Number.isSafeInteger(occurredAt) && occurredAt > 0) {
          signals.push({ kind: "READ", externalAccountId, customerRef: senderId!, occurredAt });
        }
      }
    }
  }
  return signals;
}
