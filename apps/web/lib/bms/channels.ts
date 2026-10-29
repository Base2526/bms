// =============================================================
// BMS tenant channels — เก็บ credential LINE/TikTok ต่อร้าน
// (token/secret เข้ารหัสก่อนเก็บ)
// =============================================================

import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { requireCapacityForUpsert } from "./entitlements";
import { encryptSecret, decryptSecret, maskSecret } from "./crypto";
import { lineChannelExtra } from "./lineBotIdentity";

export type Channel = "line" | "tiktok" | "facebook" | "instagram" | "web" | "shopee" | "lazada";

export type ChannelConfig = {
  channel: string;
  active: boolean;
  access_token: string | null; // decrypted (server-side use)
  channel_secret: string | null;
  webhook_verify_token: string | null;
  external_account_id: string | null;
  extra: any;
};

/** ดึง config (decrypted) — ใช้ฝั่ง server เท่านั้น (webhook/reply) */
export async function getChannel(tenantId: string, channel: string): Promise<ChannelConfig | null> {
  const res = await query<any>(
    `SELECT channel, active, access_token, channel_secret, webhook_verify_token, external_account_id, extra
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
    webhook_verify_token: decryptSecret(r.webhook_verify_token),
    external_account_id: r.external_account_id ?? null,
    extra: r.extra ?? {},
  };
}

/** list สำหรับ UI (mask token) */
export async function listChannelsMasked(tenantId: string) {
  const res = await query<any>(
    `SELECT channel, active, access_token, channel_secret, webhook_verify_token, external_account_id, extra
       FROM bms_tenant_channels WHERE tenant_id = $1 ORDER BY channel`,
    [tenantId]
  );
  return res.rows.map((r) => ({
    channel: r.channel,
    active: r.active,
    access_token_masked: maskSecret(decryptSecret(r.access_token)),
    channel_secret_masked: maskSecret(decryptSecret(r.channel_secret)),
    webhook_verify_token_masked: maskSecret(decryptSecret(r.webhook_verify_token)),
    has_token: !!r.access_token,
    has_secret: !!r.channel_secret,
    has_verify_token: !!r.webhook_verify_token,
    external_account_id: r.external_account_id ?? null,
    extra: r.extra ?? {},
  }));
}

export async function upsertChannel(
  tenantId: string,
  channel: string,
  input: { accessToken?: string | null; channelSecret?: string | null; webhookVerifyToken?: string | null; externalAccountId?: string | null; active?: boolean; extra?: any },
  actorId?: string,
) {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorId });
    await requireCapacityForUpsert(tenantId, "channels", channel, client);
    // ดึงของเดิม (ถ้ามี) — ค่า token/secret ที่ไม่ได้กรอกใหม่ให้คงเดิม
    const cur = await client.query<any>(
      `SELECT access_token, channel_secret, webhook_verify_token, external_account_id, active, extra FROM bms_tenant_channels
        WHERE tenant_id = $1 AND channel = $2`,
      [tenantId, channel]
    );
    const prev = cur.rows[0];

    // Credentials are commonly pasted from provider consoles. Strip only surrounding
    // whitespace so an invisible newline is not persisted as part of the Bearer token
    // or webhook secret.
    const normalizedAccessToken = typeof input.accessToken === "string" ? input.accessToken.trim() : "";
    const normalizedChannelSecret = typeof input.channelSecret === "string" ? input.channelSecret.trim() : "";
    const normalizedVerifyToken = typeof input.webhookVerifyToken === "string" ? input.webhookVerifyToken.trim() : "";
    const normalizedExternalAccountId = typeof input.externalAccountId === "string" ? input.externalAccountId.trim() : "";
    const accessToken = normalizedAccessToken
      ? encryptSecret(normalizedAccessToken)
      : prev?.access_token ?? null;
    const channelSecret = normalizedChannelSecret
      ? encryptSecret(normalizedChannelSecret)
      : prev?.channel_secret ?? null;
    const webhookVerifyToken = normalizedVerifyToken
      ? encryptSecret(normalizedVerifyToken)
      : prev?.webhook_verify_token ?? null;
    const externalAccountId = normalizedExternalAccountId || prev?.external_account_id || null;
    const active = input.active ?? prev?.active ?? true;
    let extra = input.extra ?? prev?.extra ?? {};
    if (channel === "line") {
      // Even an extra-only save must not forge a bot identity. Preserve the provider cache
      // for an unchanged token; a genuinely different token requires fresh verification.
      const tokenChanged = Boolean(normalizedAccessToken && normalizedAccessToken !== decryptSecret(prev?.access_token));
      extra = lineChannelExtra(prev?.extra, input.extra, tokenChanged);
    }

    // fail-closed guard เดียวกับที่ webhook route ทุกตัวบังคับ (ยกเว้น "web" ที่ไม่มี concept
    // signature เลย) — กันไม่ให้บันทึกสถานะ "active แต่ไม่มี secret" ได้ตั้งแต่ต้น ไม่งั้นช่องทางจะ
    // โดน 401 เงียบ ๆ ทุก request จนกว่าจะมีคนสังเกตเห็นใน Channel Health
    if (channel !== "web" && active && !channelSecret) {
      throw new Error("ต้องกรอก channel secret ก่อนเปิดใช้งานช่องทางนี้ (ป้องกันการปลอม webhook)");
    }
    if ((channel === "facebook" || channel === "instagram") && active) {
      const effectiveAccessToken = normalizedAccessToken || decryptSecret(prev?.access_token) || "";
      const effectiveAppSecret = normalizedChannelSecret || decryptSecret(prev?.channel_secret) || "";
      const effectiveVerifyToken = normalizedVerifyToken || decryptSecret(prev?.webhook_verify_token) || "";
      if (!effectiveAccessToken) throw new Error("ต้องกรอก Page Access Token ก่อนเปิด Meta channel");
      if (effectiveVerifyToken.length < 32) throw new Error("Webhook Verify Token ต้องมีอย่างน้อย 32 ตัวอักษร");
      if (effectiveVerifyToken === effectiveAppSecret) throw new Error("Webhook Verify Token ต้องไม่ซ้ำกับ App Secret");
      if (!externalAccountId || !/^\d{5,32}$/.test(externalAccountId)) {
        throw new Error("ต้องกรอก Facebook Page ID ที่ถูกต้องก่อนเปิด Meta channel");
      }
    }

    await client.query(
      `INSERT INTO bms_tenant_channels
         (tenant_id, channel, access_token, channel_secret, webhook_verify_token, external_account_id, active, extra)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, channel) DO UPDATE SET
         access_token   = EXCLUDED.access_token,
         channel_secret = EXCLUDED.channel_secret,
         webhook_verify_token = EXCLUDED.webhook_verify_token,
         external_account_id = EXCLUDED.external_account_id,
         active         = EXCLUDED.active,
         extra          = EXCLUDED.extra,
         updated_at     = now()`,
      [tenantId, channel, accessToken, channelSecret, webhookVerifyToken, externalAccountId, active, extra]
    );
    await client.query(`INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
      VALUES($1,$2,'channel.upsert',$3,$4)`, [tenantId, actorId ?? "system", channel, JSON.stringify({ active })]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
