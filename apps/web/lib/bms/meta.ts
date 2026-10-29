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
};

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
        out.push({ externalAccountId, senderId, text, eventId, attachments: [] });
        continue;
      }
      const eventId = typeof ev?.message?.mid === "string" ? ev.message.mid.trim() : "";
      const text = typeof ev?.message?.text === "string" ? ev.message.text.trim() : "";
      const attachments = Array.isArray(ev?.message?.attachments)
        ? ev.message.attachments.map((att: any) => ({
          type: typeof att?.type === "string" ? att.type : null,
          url: typeof att?.payload?.url === "string" ? att.payload.url : null,
          title: typeof att?.title === "string" ? att.title : null,
          mimeType: typeof att?.mime_type === "string" ? att.mime_type : null,
        }))
        : [];
      // ข้าม echo (ข้อความที่เพจ/บัญชีส่งเอง) และ event ที่ไม่มีเนื้อหาให้ทีมเห็น
      if (typeof senderId === "string" && /^\d{5,64}$/.test(senderId) && eventId && !ev?.message?.is_echo && (text || attachments.length > 0)) {
        out.push({
          externalAccountId,
          senderId,
          text,
          attachments,
          eventId,
        });
      }
    }
  }
  return out;
}
