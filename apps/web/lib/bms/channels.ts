// =============================================================
// BMS tenant channels — เก็บ credential LINE/TikTok ต่อร้าน
// (token/secret เข้ารหัสก่อนเก็บ)
// =============================================================

import { query } from "@/lib/db";
import { encryptSecret, decryptSecret, maskSecret } from "./crypto";

export type Channel = "line" | "tiktok" | "facebook" | "instagram" | "web" | "shopee" | "lazada";

export type ChannelConfig = {
  channel: string;
  active: boolean;
  access_token: string | null; // decrypted (server-side use)
  channel_secret: string | null;
  extra: any;
};

/** ดึง config (decrypted) — ใช้ฝั่ง server เท่านั้น (webhook/reply) */
export async function getChannel(tenantId: string, channel: string): Promise<ChannelConfig | null> {
  const res = await query<any>(
    `SELECT channel, active, access_token, channel_secret, extra
       FROM bms_tenant_channels WHERE tenant_id = $1 AND channel = $2`,
    [tenantId, channel]
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    channel: r.channel,
    active: r.active,
    access_token: decryptSecret(r.access_token),
    channel_secret: decryptSecret(r.channel_secret),
    extra: r.extra ?? {},
  };
}

/** list สำหรับ UI (mask token) */
export async function listChannelsMasked(tenantId: string) {
  const res = await query<any>(
    `SELECT channel, active, access_token, channel_secret, extra
       FROM bms_tenant_channels WHERE tenant_id = $1 ORDER BY channel`,
    [tenantId]
  );
  return res.rows.map((r) => ({
    channel: r.channel,
    active: r.active,
    access_token_masked: maskSecret(decryptSecret(r.access_token)),
    channel_secret_masked: maskSecret(decryptSecret(r.channel_secret)),
    has_token: !!r.access_token,
    has_secret: !!r.channel_secret,
    extra: r.extra ?? {},
  }));
}

export async function upsertChannel(
  tenantId: string,
  channel: string,
  input: { accessToken?: string | null; channelSecret?: string | null; active?: boolean; extra?: any }
) {
  // ดึงของเดิม (ถ้ามี) — ค่า token/secret ที่ไม่ได้กรอกใหม่ให้คงเดิม
  const cur = await query<any>(
    `SELECT access_token, channel_secret, active, extra FROM bms_tenant_channels
      WHERE tenant_id = $1 AND channel = $2`,
    [tenantId, channel]
  );
  const prev = cur.rows[0];

  const hasNew = (v: unknown) => typeof v === "string" && v.trim() !== "";
  const accessToken = hasNew(input.accessToken)
    ? encryptSecret(input.accessToken as string)
    : prev?.access_token ?? null;
  const channelSecret = hasNew(input.channelSecret)
    ? encryptSecret(input.channelSecret as string)
    : prev?.channel_secret ?? null;
  const active = input.active ?? prev?.active ?? true;
  const extra = input.extra ?? prev?.extra ?? {};

  await query(
    `INSERT INTO bms_tenant_channels (tenant_id, channel, access_token, channel_secret, active, extra)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, channel) DO UPDATE SET
       access_token   = EXCLUDED.access_token,
       channel_secret = EXCLUDED.channel_secret,
       active         = EXCLUDED.active,
       extra          = EXCLUDED.extra,
       updated_at     = now()`,
    [tenantId, channel, accessToken, channelSecret, active, extra]
  );
  return true;
}
