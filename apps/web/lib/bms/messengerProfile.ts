import { getClient } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { getChannel } from "./channels";
import { META_STARTER_MESSAGES } from "./meta";

export type MessengerProfile = {
  greeting: string;
  starterPayloads: string[];
  status: "DRAFT" | "PUBLISHED" | "FAILED";
  publishedAt: string | null;
  lastError: string | null;
};

const DEFAULT_GREETING = "สวัสดีค่ะ สนใจสินค้าหรือบริการด้านไหน เลือกหัวข้อด้านล่างได้เลยค่ะ";
const DEFAULT_STARTERS = ["BMS_CHAT_PRICE", "BMS_CHAT_DETAILS", "BMS_CHAT_INTERESTED"];

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function normalizeMessengerProfile(input: { greeting?: unknown; starterPayloads?: unknown }): MessengerProfile {
  const greeting = text(input.greeting, 160);
  if (!greeting) throw new Error("ต้องระบุข้อความต้อนรับ Messenger");
  const source = Array.isArray(input.starterPayloads) ? input.starterPayloads : [];
  const starterPayloads = Array.from(new Set(source.map((value) => text(value, 80))))
    .filter((value) => Object.hasOwn(META_STARTER_MESSAGES, value) && value !== "BMS_CHAT_START")
    .slice(0, 4);
  if (starterPayloads.length === 0) throw new Error("เลือกหัวข้อเริ่มแชทอย่างน้อย 1 หัวข้อ");
  return { greeting, starterPayloads, status: "DRAFT", publishedAt: null, lastError: null };
}

function fromExtra(extra: unknown): MessengerProfile {
  const value = extra && typeof extra === "object" ? (extra as any).messengerProfile : null;
  try {
    const normalized = normalizeMessengerProfile({
      greeting: value?.greeting ?? DEFAULT_GREETING,
      starterPayloads: value?.starterPayloads ?? DEFAULT_STARTERS,
    });
    return {
      ...normalized,
      status: ["DRAFT", "PUBLISHED", "FAILED"].includes(value?.status) ? value.status : "DRAFT",
      publishedAt: text(value?.publishedAt, 80) || null,
      lastError: text(value?.lastError, 500) || null,
    };
  } catch {
    return { ...normalizeMessengerProfile({ greeting: DEFAULT_GREETING, starterPayloads: DEFAULT_STARTERS }) };
  }
}

export async function getMessengerProfile(tenantId: string): Promise<MessengerProfile> {
  return fromExtra((await getChannel(tenantId, "facebook"))?.extra);
}

async function saveState(
  tenantId: string,
  actorId: string,
  profile: MessengerProfile,
  action: "channel.messenger_profile.save" | "channel.messenger_profile.publish" | "channel.messenger_profile.publish_failed",
) {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId, { editorId: actorId });
    const updated = await client.query(
      `UPDATE bms_tenant_channels
          SET extra = jsonb_set(COALESCE(extra, '{}'::jsonb), '{messengerProfile}', $2::jsonb, true),
              updated_at = now()
        WHERE tenant_id = $1 AND channel = 'facebook'`,
      [tenantId, JSON.stringify(profile)],
    );
    if (!updated.rowCount) throw new Error("กรุณาตั้งค่า Facebook Messenger ก่อน");
    await client.query(
      `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta)
       VALUES ($1,$2,$3,'facebook',$4::jsonb)`,
      [tenantId, `user:${actorId}`, action, JSON.stringify({ status: profile.status, starterCount: profile.starterPayloads.length })],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function metaGraphVersion(): string {
  const value = process.env.META_GRAPH_VERSION?.trim();
  return value && /^v\d+\.\d+$/.test(value) ? value : "v26.0";
}

export async function publishMessengerProfile(
  tenantId: string,
  actorId: string,
  input: { greeting?: unknown; starterPayloads?: unknown },
): Promise<MessengerProfile> {
  const draft = normalizeMessengerProfile(input);
  await saveState(tenantId, actorId, draft, "channel.messenger_profile.save");

  const channel = await getChannel(tenantId, "facebook");
  if (!channel?.active || !channel.access_token) throw new Error("ต้องเปิด Facebook Messenger และตั้ง Page Access Token ก่อนเผยแพร่");
  try {
    const response = await fetch(`https://graph.facebook.com/${metaGraphVersion()}/me/messenger_profile`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${channel.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        greeting: [{ locale: "default", text: draft.greeting }],
        get_started: { payload: "BMS_CHAT_START" },
        ice_breakers: draft.starterPayloads.map((payload) => ({
          question: META_STARTER_MESSAGES[payload],
          payload,
        })),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.result !== "success") {
      throw new Error(text(result?.error?.message, 500) || `Meta HTTP ${response.status}`);
    }
    const published: MessengerProfile = { ...draft, status: "PUBLISHED", publishedAt: new Date().toISOString(), lastError: null };
    await saveState(tenantId, actorId, published, "channel.messenger_profile.publish");
    return published;
  } catch (error: any) {
    const failed: MessengerProfile = { ...draft, status: "FAILED", publishedAt: null, lastError: text(error?.message, 500) || "Meta publish failed" };
    await saveState(tenantId, actorId, failed, "channel.messenger_profile.publish_failed");
    throw new Error(`บันทึกแบบร่างแล้ว แต่เผยแพร่ไป Meta ไม่สำเร็จ: ${failed.lastError}`);
  }
}
