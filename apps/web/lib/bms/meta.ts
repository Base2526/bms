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

export type MetaEvent = { senderId: string; text: string; eventId: string | null };

/** แกะข้อความ text จาก payload (รองรับทั้ง Messenger และ IG) */
export function parseMetaEvents(body: any): MetaEvent[] {
  const out: MetaEvent[] = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];
    for (const ev of messaging) {
      const senderId = ev?.sender?.id;
      const text = ev?.message?.text?.trim();
      // ข้าม echo (ข้อความที่เพจ/บัญชีส่งเอง) และ event ที่ไม่มี text
      if (senderId && text && !ev?.message?.is_echo) {
        out.push({
          senderId,
          text,
          eventId: typeof ev?.message?.mid === "string" ? ev.message.mid : null,
        });
      }
    }
  }
  return out;
}
