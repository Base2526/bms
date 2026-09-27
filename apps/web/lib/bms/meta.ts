// =============================================================
// BMS Meta (Facebook Messenger / Instagram) webhook helpers
// -------------------------------------------------------------
// FB Messenger + IG DM ใช้ Messenger Platform เดียวกัน (graph.facebook.com)
//   • GET  = verification (hub.challenge)
//   • POST = events { object, entry[].messaging[] }
// signature = X-Hub-Signature-256 (HMAC-SHA256 ด้วย App Secret) — verify ใน route
// =============================================================

import type { ChannelConfig } from "./channels";

/** ตอบ challenge ตอนตั้ง webhook (GET) — verify_token เทียบกับ channel_secret ที่ตั้งไว้ */
export function metaChallenge(url: URL, cfg: ChannelConfig | null): string | null {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode !== "subscribe" || !challenge) return null;
  // ถ้าตั้ง channel_secret ไว้ → verify_token ต้องตรง; ถ้ายังไม่ตั้ง → ผ่าน (ช่วงตั้งค่า)
  if (cfg?.channel_secret && token !== cfg.channel_secret) return null;
  return challenge;
}

export type MetaEvent = {
  senderId: string;
  text: string;
  eventId: string | null;
  attachments: Array<{ type: string | null; url: string | null; title?: string | null; mimeType?: string | null }>;
};

/** แกะข้อความและ attachment จาก payload (รองรับทั้ง Messenger และ IG) */
export function parseMetaEvents(body: any): MetaEvent[] {
  const out: MetaEvent[] = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];
    for (const ev of messaging) {
      const senderId = ev?.sender?.id;
      const text = ev?.message?.text?.trim() ?? "";
      const attachments = Array.isArray(ev?.message?.attachments)
        ? ev.message.attachments.map((att: any) => ({
          type: typeof att?.type === "string" ? att.type : null,
          url: typeof att?.payload?.url === "string" ? att.payload.url : null,
          title: typeof att?.title === "string" ? att.title : null,
          mimeType: typeof att?.mime_type === "string" ? att.mime_type : null,
        }))
        : [];
      // ข้าม echo (ข้อความที่เพจ/บัญชีส่งเอง) และ event ที่ไม่มีเนื้อหาให้ทีมเห็น
      if (senderId && !ev?.message?.is_echo && (text || attachments.length > 0)) {
        out.push({
          senderId,
          text,
          attachments,
          eventId: typeof ev?.message?.mid === "string" ? ev.message.mid : null,
        });
      }
    }
  }
  return out;
}
