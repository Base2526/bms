// =============================================================
// LINE OA profile sync — best-effort channel profile cache
// -------------------------------------------------------------
// LINE webhook payloads include source.userId. The display name/avatar
// are fetched separately via Messaging API and cached on
// bms_customer_identities so Inbox can show a human-friendly customer
// card without calling LINE from UI renders.
// =============================================================

import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";
import { decryptSecret } from "./crypto";
import { hasVerifiedLineBotIdentity, lineBotTokenHash } from "./lineBotIdentity";
import { getChannel } from "./channels";
import { resolveOrCreateCustomer } from "./customers";
import { notifyInboxConversationChanged } from "./inbox";

export type LineProfileSyncResult = {
  ok: boolean;
  skipped?: "missing-token" | "missing-user" | "invalid-user" | "fresh" | "recent-error";
  status?: number;
  error?: string;
  conversationIds: string[];
};

type LineProfile = {
  userId?: string;
  displayName?: string;
  pictureUrl?: string;
  statusMessage?: string;
  language?: string;
};

const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;
const ERROR_RETRY_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 900;
const BOT_INFO_TTL_MS = 24 * 60 * 60 * 1000;
const LINE_USER_ID_RE = /^U[0-9a-f]{32}$/i;

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function cleanHttpsUrl(value: unknown): string | null {
  const candidate = cleanText(value, 1_000);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function shouldSkipFresh(value: unknown): boolean {
  const syncedAt = value instanceof Date ? value.getTime() : value ? new Date(String(value)).getTime() : 0;
  return Number.isFinite(syncedAt) && syncedAt > 0 && Date.now() - syncedAt < PROFILE_TTL_MS;
}

async function fetchLineProfile(accessToken: string, userId: string): Promise<{ ok: true; profile: LineProfile } | { ok: false; status: number; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    const text = await resp.text().catch(() => "");
    if (!resp.ok) return { ok: false, status: resp.status, detail: `LINE_PROFILE_HTTP_${resp.status}` };
    try {
      return { ok: true, profile: JSON.parse(text || "{}") as LineProfile };
    } catch {
      return { ok: false, status: resp.status, detail: "LINE_PROFILE_INVALID_JSON" };
    }
  } catch (error: any) {
    return {
      ok: false,
      status: 0,
      detail: error?.name === "AbortError" ? "LINE_PROFILE_TIMEOUT" : "LINE_PROFILE_NETWORK_ERROR",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLineBotInfo(accessToken: string): Promise<{ ok: true; info: any } | { ok: false; status: number; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch("https://api.line.me/v2/bot/info", {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    const text = await resp.text().catch(() => "");
    if (!resp.ok) {
      return { ok: false, status: resp.status, detail: text.slice(0, 300) || resp.statusText };
    }
    return { ok: true, info: JSON.parse(text || "{}") };
  } catch (error: any) {
    return { ok: false, status: 0, detail: error?.name === "AbortError" ? "timeout" : String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

async function recordProfileError(tenantId: string, userId: string, detail: string): Promise<string[]> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const updated = await client.query<{ id: string }>(
      `UPDATE bms_customer_identities
          SET profile_error_at = now(), profile_error = $3, updated_at = now()
        WHERE tenant_id = $1 AND channel = 'line' AND external_ref = $2
        RETURNING (
          SELECT c.id
            FROM bms_conversations c
           WHERE c.tenant_id = $1 AND c.channel = 'line' AND c.customer_ref = $2
           LIMIT 1
        ) AS id`,
      [tenantId, userId, detail.slice(0, 300)]
    );
    await client.query("COMMIT");
    return updated.rows.map((r) => r.id).filter(Boolean);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function upsertLineProfile(
  tenantId: string,
  userId: string,
  profile: LineProfile
): Promise<string[]> {
  const displayName = cleanText(profile.displayName, 255);
  const pictureUrl = cleanHttpsUrl(profile.pictureUrl);
  const statusMessage = cleanText(profile.statusMessage, 500);
  const language = cleanText(profile.language, 32);

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${tenantId}:line:${userId}`]);

    const customerId = await resolveOrCreateCustomer(client, tenantId, "line", userId);
    if (!customerId) throw new Error("LINE_PROFILE_IDENTITY_UNAVAILABLE");

    await client.query(
      `UPDATE bms_customer_identities SET
          display_name = COALESCE($3, display_name),
          picture_url = COALESCE($4, picture_url),
          status_message = COALESCE($5, status_message),
          language = COALESCE($6, language),
          profile_synced_at = now(),
          profile_error_at = NULL,
          profile_error = NULL,
          updated_at = now()
        WHERE tenant_id = $1 AND channel = 'line' AND external_ref = $2`,
      [tenantId, userId, displayName, pictureUrl, statusMessage, language]
    );

    const conversations = await client.query<{ id: string }>(
      `UPDATE bms_conversations
          SET customer_id = COALESCE(customer_id, $3),
              updated_at = now()
        WHERE tenant_id = $1 AND channel = 'line' AND customer_ref = $2
        RETURNING id`,
      [tenantId, userId, customerId]
    );

    await client.query("COMMIT");
    return conversations.rows.map((r) => r.id);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Sync a LINE user profile if the cached identity profile is missing/stale.
 * This must never be required for accepting a webhook message; callers should
 * log and continue when it fails.
 */
export async function syncLineUserProfile(
  tenantId: string,
  userId: string | null,
  accessToken: string | null
): Promise<LineProfileSyncResult> {
  if (!userId) return { ok: false, skipped: "missing-user", conversationIds: [] };
  if (!LINE_USER_ID_RE.test(userId)) return { ok: false, skipped: "invalid-user", conversationIds: [] };
  if (!accessToken) return { ok: false, skipped: "missing-token", conversationIds: [] };

  const cached = await query<{ profile_synced_at: Date | string | null; profile_error_at: Date | string | null }>(
    `SELECT profile_synced_at, profile_error_at
       FROM bms_customer_identities
      WHERE tenant_id = $1 AND channel = 'line' AND external_ref = $2
      LIMIT 1`,
    [tenantId, userId]
  );
  if (cached.rows[0]?.profile_synced_at && shouldSkipFresh(cached.rows[0].profile_synced_at)) {
    return { ok: true, skipped: "fresh", conversationIds: [] };
  }
  const recentErrorAt = cached.rows[0]?.profile_error_at;
  const recentErrorMs = recentErrorAt instanceof Date
    ? recentErrorAt.getTime()
    : recentErrorAt ? new Date(String(recentErrorAt)).getTime() : 0;
  if (Number.isFinite(recentErrorMs) && recentErrorMs > 0 && Date.now() - recentErrorMs < ERROR_RETRY_MS) {
    return { ok: false, skipped: "recent-error", conversationIds: [] };
  }

  const fetched = await fetchLineProfile(accessToken, userId);
  if (!fetched.ok) {
    const conversationIds = await recordProfileError(tenantId, userId, fetched.detail).catch(() => []);
    return { ok: false, status: fetched.status, error: fetched.detail, conversationIds };
  }

  if (fetched.profile.userId && fetched.profile.userId !== userId) {
    const detail = "LINE_PROFILE_ID_MISMATCH";
    const conversationIds = await recordProfileError(tenantId, userId, detail).catch(() => []);
    return { ok: false, status: 200, error: detail, conversationIds };
  }
  if (!cleanText(fetched.profile.displayName, 255) && !cleanHttpsUrl(fetched.profile.pictureUrl)) {
    const detail = "LINE_PROFILE_EMPTY";
    const conversationIds = await recordProfileError(tenantId, userId, detail).catch(() => []);
    return { ok: false, status: 200, error: detail, conversationIds };
  }

  const conversationIds = await upsertLineProfile(tenantId, userId, fetched.profile);
  return { ok: true, conversationIds };
}

/** Bounded scheduled backfill so existing LINE conversations gain cached profile metadata. */
export async function runLineProfileBackfill(
  limit = 20,
): Promise<{ attempted: number; updated: number; failed: number; botProfiles: number }> {
  limit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 50)) : 20;
  const candidates = await query<{ tenant_id: string; external_ref: string }>(
    `SELECT ci.tenant_id, ci.external_ref
       FROM bms_customer_identities ci
       JOIN bms_tenant_channels tc ON tc.tenant_id = ci.tenant_id AND tc.channel = 'line'
      WHERE ci.channel = 'line' AND tc.active = true AND tc.access_token IS NOT NULL
        AND ci.external_ref ~ '^U[0-9a-fA-F]{32}$'
        AND (ci.profile_synced_at IS NULL OR ci.profile_synced_at < now() - interval '24 hours')
        AND (ci.profile_error_at IS NULL OR ci.profile_error_at < now() - interval '15 minutes')
      ORDER BY ci.profile_synced_at NULLS FIRST, ci.updated_at
      LIMIT $1`,
    [limit],
  );
  let updated = 0;
  let failed = 0;
  let botProfiles = 0;
  const botSynced = new Set<string>();
  for (const candidate of candidates.rows) {
    const cfg = await getChannel(candidate.tenant_id, "line");
    if (!cfg?.active || !cfg.access_token) continue;
    if (!botSynced.has(candidate.tenant_id)) {
      botSynced.add(candidate.tenant_id);
      const bot: Awaited<ReturnType<typeof syncLineBotInfo>> =
        await syncLineBotInfo(candidate.tenant_id, cfg.access_token).catch(() => ({ ok: false }));
      if (bot.ok && !bot.skipped) botProfiles += 1;
    }
    try {
      const result = await syncLineUserProfile(candidate.tenant_id, candidate.external_ref, cfg.access_token);
      if (result.ok && !result.skipped) updated += 1;
      else if (!result.skipped) failed += 1;
      for (const conversationId of result.conversationIds) {
        notifyInboxConversationChanged(candidate.tenant_id, conversationId, "CONVERSATION_CHANGED");
      }
    } catch {
      failed += 1;
    }
  }
  return { attempted: candidates.rows.length, updated, failed, botProfiles };
}

async function writeLineBotCache(tenantId: string, storedToken: string, patch: Record<string, unknown>) {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const saved = await client.query<{ extra: Record<string, unknown> }>(
      `UPDATE bms_tenant_channels
          SET extra = COALESCE(extra, '{}'::jsonb) || $3::jsonb, updated_at = now()
        WHERE tenant_id = $1 AND channel = $2 AND access_token = $4
        RETURNING extra`,
      [tenantId, "line", JSON.stringify(patch), storedToken]
    );
    await client.query("COMMIT");
    return saved.rows[0]?.extra;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function syncLineBotInfo(
  tenantId: string,
  accessToken: string | null
): Promise<{ ok: boolean; skipped?: "missing-token" | "fresh" | "credential-changed"; status?: number; error?: string; extra?: Record<string, unknown> }> {
  if (!accessToken) return { ok: false, skipped: "missing-token" };

  const current = await query<{ extra: any; access_token: string | null }>(
    `SELECT extra, access_token FROM bms_tenant_channels WHERE tenant_id = $1 AND channel = 'line' LIMIT 1`,
    [tenantId]
  );
  const extra = current.rows[0]?.extra ?? {};
  const storedToken = current.rows[0]?.access_token;
  if (!storedToken || decryptSecret(storedToken) !== accessToken) return { ok: false, skipped: "credential-changed" };
  if (hasVerifiedLineBotIdentity(extra, accessToken) && shouldSkipFreshWithTtl(extra.botInfoSyncedAt, BOT_INFO_TTL_MS)) {
    return { ok: true, skipped: "fresh", extra };
  }

  const fetched = await fetchLineBotInfo(accessToken);
  if (!fetched.ok) {
    await writeLineBotCache(tenantId, storedToken, {
      botInfoErrorAt: new Date().toISOString(), botInfoError: fetched.detail.slice(0, 300),
    }).catch(() => undefined);
    return { ok: false, status: fetched.status, error: fetched.detail };
  }
  const info = fetched.info || {};
  const verified = {
    botDisplayName: cleanText(info.displayName, 255),
    botBasicId: cleanText(info.basicId, 255),
    botPictureUrl: cleanHttpsUrl(info.pictureUrl),
    botChatMode: cleanText(info.chatMode, 64),
    botInfoSyncedAt: new Date().toISOString(),
    botIdentityTokenHash: lineBotTokenHash(accessToken),
    botInfoErrorAt: null,
    botInfoError: null,
  };
  if (!hasVerifiedLineBotIdentity(verified, accessToken)) return { ok: false, error: "invalid bot identity" };
  // A token can be replaced while LINE is responding. Never attach the old bot to it.
  const saved = await writeLineBotCache(tenantId, storedToken, verified);
  return saved ? { ok: true, extra: saved } : { ok: false, skipped: "credential-changed" };
}

function shouldSkipFreshWithTtl(value: unknown, ttlMs: number): boolean {
  const syncedAt = value instanceof Date ? value.getTime() : value ? new Date(String(value)).getTime() : 0;
  return Number.isFinite(syncedAt) && syncedAt > 0 && Date.now() - syncedAt < ttlMs;
}
