// =============================================================
// Facebook Messenger profile sync — best-effort channel cache
// -------------------------------------------------------------
// Messenger webhooks identify a customer by Page-scoped ID (PSID)
// but do not include the customer's display name or profile photo.
// Fetch those fields separately and cache them on the channel identity
// so Inbox reads never call Meta and staff-maintained CRM fields remain
// authoritative.
// =============================================================

import { getClient, query } from "@/lib/db";
import { getChannel } from "./channels";
import { resolveOrCreateCustomer } from "./customers";
import { notifyInboxConversationChanged } from "./inbox";
import { beginTenantTx } from "./tenant";

export type FacebookProfileSyncResult = {
  ok: boolean;
  skipped?: "missing-token" | "missing-user" | "fresh" | "recent-error";
  status?: number;
  error?: string;
  conversationIds: string[];
};

type FacebookProfile = {
  id?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  profile_pic?: string;
};

type FacebookPageProfile = {
  id?: string;
  name?: string;
  username?: string;
  picture?: { data?: { url?: string } };
};

const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;
const ERROR_RETRY_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1_200;

function metaGraphVersion(): string {
  const configured = process.env.META_GRAPH_VERSION?.trim();
  return configured && /^v\d+\.\d+$/.test(configured) ? configured : "v26.0";
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
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

function isFresh(value: unknown): boolean {
  const syncedAt = value instanceof Date ? value.getTime() : value ? new Date(String(value)).getTime() : 0;
  return Number.isFinite(syncedAt) && syncedAt > 0 && Date.now() - syncedAt < PROFILE_TTL_MS;
}

function profileDisplayName(profile: FacebookProfile): string | null {
  const fullName = cleanText(profile.name, 255);
  if (fullName) return fullName;
  const firstName = cleanText(profile.first_name, 120);
  const lastName = cleanText(profile.last_name, 120);
  return cleanText([firstName, lastName].filter(Boolean).join(" "), 255);
}

function providerError(status: number, bodyText: string): string {
  try {
    const error = JSON.parse(bodyText)?.error;
    const code = typeof error?.code === "number" ? `_${error.code}` : "";
    const message = cleanText(error?.message, 180);
    return `META_PROFILE_HTTP_${status}${code}${message ? `: ${message}` : ""}`;
  } catch {
    return `META_PROFILE_HTTP_${status}`;
  }
}

async function fetchFacebookProfile(
  accessToken: string,
  psid: string,
): Promise<{ ok: true; profile: FacebookProfile } | { ok: false; status: number; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const fields = "id,name,first_name,last_name,profile_pic";
  try {
    const response = await fetch(
      `https://graph.facebook.com/${metaGraphVersion()}/${encodeURIComponent(psid)}?fields=${encodeURIComponent(fields)}`,
      {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      },
    );
    const bodyText = await response.text().catch(() => "");
    if (!response.ok) {
      return { ok: false, status: response.status, detail: providerError(response.status, bodyText) };
    }
    try {
      return { ok: true, profile: JSON.parse(bodyText || "{}") as FacebookProfile };
    } catch {
      return { ok: false, status: response.status, detail: "META_PROFILE_INVALID_JSON" };
    }
  } catch (error: any) {
    return {
      ok: false,
      status: 0,
      detail: error?.name === "AbortError" ? "META_PROFILE_TIMEOUT" : "META_PROFILE_NETWORK_ERROR",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFacebookPageProfile(
  accessToken: string,
  pageId: string,
): Promise<{ ok: true; profile: FacebookPageProfile } | { ok: false; status: number; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const fields = "id,name,username,picture";
    const response = await fetch(
      `https://graph.facebook.com/${metaGraphVersion()}/${encodeURIComponent(pageId)}?fields=${encodeURIComponent(fields)}`,
      { headers: { authorization: `Bearer ${accessToken}` }, signal: controller.signal },
    );
    const bodyText = await response.text().catch(() => "");
    if (!response.ok) return { ok: false, status: response.status, detail: providerError(response.status, bodyText) };
    try {
      return { ok: true, profile: JSON.parse(bodyText || "{}") as FacebookPageProfile };
    } catch {
      return { ok: false, status: response.status, detail: "META_PAGE_PROFILE_INVALID_JSON" };
    }
  } catch (error: any) {
    return { ok: false, status: 0,
      detail: error?.name === "AbortError" ? "META_PAGE_PROFILE_TIMEOUT" : "META_PAGE_PROFILE_NETWORK_ERROR" };
  } finally {
    clearTimeout(timer);
  }
}

async function recordProfileError(tenantId: string, psid: string, detail: string): Promise<string[]> {
  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    const updated = await client.query<{ id: string }>(
      `UPDATE bms_customer_identities
          SET profile_error_at=now(), profile_error=$3, updated_at=now()
        WHERE tenant_id=$1 AND channel='facebook' AND external_ref=$2
        RETURNING (
          SELECT c.id FROM bms_conversations c
           WHERE c.tenant_id=$1 AND c.channel='facebook' AND c.customer_ref=$2
           LIMIT 1
        ) AS id`,
      [tenantId, psid, detail.slice(0, 300)],
    );
    await client.query("COMMIT");
    return updated.rows.map((row) => row.id).filter(Boolean);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function upsertFacebookProfile(
  tenantId: string,
  psid: string,
  profile: FacebookProfile,
): Promise<string[]> {
  const displayName = profileDisplayName(profile);
  const pictureUrl = cleanHttpsUrl(profile.profile_pic);

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${tenantId}:facebook:${psid}`]);
    const customerId = await resolveOrCreateCustomer(client, tenantId, "facebook", psid);
    if (!customerId) throw new Error("FACEBOOK_PROFILE_IDENTITY_UNAVAILABLE");

    await client.query(
      `UPDATE bms_customer_identities
          SET display_name=COALESCE($3,display_name),
              picture_url=COALESCE($4,picture_url),
              profile_synced_at=now(), profile_error_at=NULL, profile_error=NULL, updated_at=now()
        WHERE tenant_id=$1 AND channel='facebook' AND external_ref=$2`,
      [tenantId, psid, displayName, pictureUrl],
    );
    const conversations = await client.query<{ id: string }>(
      `UPDATE bms_conversations
          SET customer_id=COALESCE(customer_id,$3), updated_at=now()
        WHERE tenant_id=$1 AND channel='facebook' AND customer_ref=$2
        RETURNING id`,
      [tenantId, psid, customerId],
    );
    await client.query("COMMIT");
    return conversations.rows.map((row) => row.id);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Refresh a Facebook Messenger customer's channel profile at most once per day.
 * Callers must treat this as optional enrichment: a profile failure can never
 * block an already verified inbound message or its reply.
 */
export async function syncFacebookUserProfile(
  tenantId: string,
  psid: string | null,
  accessToken: string | null,
): Promise<FacebookProfileSyncResult> {
  if (!psid) return { ok: false, skipped: "missing-user", conversationIds: [] };
  if (!accessToken) return { ok: false, skipped: "missing-token", conversationIds: [] };

  const cached = await query<{ profile_synced_at: Date | string | null; profile_error_at: Date | string | null }>(
    `SELECT profile_synced_at,profile_error_at FROM bms_customer_identities
      WHERE tenant_id=$1 AND channel='facebook' AND external_ref=$2 LIMIT 1`,
    [tenantId, psid],
  );
  if (cached.rows[0]?.profile_synced_at && isFresh(cached.rows[0].profile_synced_at)) {
    return { ok: true, skipped: "fresh", conversationIds: [] };
  }
  const recentErrorAt = cached.rows[0]?.profile_error_at;
  const recentErrorMs = recentErrorAt instanceof Date
    ? recentErrorAt.getTime()
    : recentErrorAt ? new Date(String(recentErrorAt)).getTime() : 0;
  if (Number.isFinite(recentErrorMs) && recentErrorMs > 0 && Date.now() - recentErrorMs < ERROR_RETRY_MS) {
    return { ok: false, skipped: "recent-error", conversationIds: [] };
  }

  const fetched = await fetchFacebookProfile(accessToken, psid);
  if (!fetched.ok) {
    const conversationIds = await recordProfileError(tenantId, psid, fetched.detail).catch(() => []);
    return { ok: false, status: fetched.status, error: fetched.detail, conversationIds };
  }
  if (fetched.profile.id && fetched.profile.id !== psid) {
    const detail = "META_PROFILE_ID_MISMATCH";
    const conversationIds = await recordProfileError(tenantId, psid, detail).catch(() => []);
    return { ok: false, status: 200, error: detail, conversationIds };
  }
  if (!profileDisplayName(fetched.profile) && !cleanHttpsUrl(fetched.profile.profile_pic)) {
    const detail = "META_PROFILE_EMPTY";
    const conversationIds = await recordProfileError(tenantId, psid, detail).catch(() => []);
    return { ok: false, status: 200, error: detail, conversationIds };
  }

  const conversationIds = await upsertFacebookProfile(tenantId, psid, fetched.profile);
  return { ok: true, conversationIds };
}

export async function syncFacebookPageProfile(
  tenantId: string,
  pageId: string | null,
  accessToken: string | null,
): Promise<{ ok: boolean; skipped?: "missing-config" | "fresh"; status?: number; error?: string }> {
  if (!pageId || !accessToken) return { ok: false, skipped: "missing-config" };
  const current = await query<{ extra: any }>(
    `SELECT extra FROM bms_tenant_channels
      WHERE tenant_id=$1 AND channel='facebook' AND external_account_id=$2 LIMIT 1`,
    [tenantId, pageId],
  );
  const extra = current.rows[0]?.extra ?? {};
  if (extra.pageProfileSyncedAt && isFresh(extra.pageProfileSyncedAt)) return { ok: true, skipped: "fresh" };

  const fetched = await fetchFacebookPageProfile(accessToken, pageId);
  if (!fetched.ok) return { ok: false, status: fetched.status, error: fetched.detail };
  if (fetched.profile.id && fetched.profile.id !== pageId) {
    return { ok: false, status: 200, error: "META_PAGE_PROFILE_ID_MISMATCH" };
  }
  const displayName = cleanText(fetched.profile.name, 255);
  const username = cleanText(fetched.profile.username, 255);
  const pictureUrl = cleanHttpsUrl(fetched.profile.picture?.data?.url);
  if (!displayName && !pictureUrl) return { ok: false, status: 200, error: "META_PAGE_PROFILE_EMPTY" };

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    await client.query(
      `UPDATE bms_tenant_channels
          SET extra=COALESCE(extra,'{}'::jsonb) || $3::jsonb,updated_at=now()
        WHERE tenant_id=$1 AND channel='facebook' AND external_account_id=$2`,
      [tenantId, pageId, JSON.stringify({
        botDisplayName: displayName,
        botBasicId: username,
        botPictureUrl: pictureUrl,
        pageProfileSyncedAt: new Date().toISOString(),
      })],
    );
    await client.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Bounded scheduled backfill so existing conversations gain profiles without waiting for a new message. */
export async function runFacebookProfileBackfill(
  limit = 20,
): Promise<{ attempted: number; updated: number; failed: number; pageProfiles: number }> {
  limit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 50)) : 20;
  const candidates = await query<{ tenant_id: string; external_ref: string }>(
    `SELECT ci.tenant_id,ci.external_ref
       FROM bms_customer_identities ci
       JOIN bms_tenant_channels tc ON tc.tenant_id=ci.tenant_id AND tc.channel='facebook'
      WHERE ci.channel='facebook' AND tc.active=true AND tc.access_token IS NOT NULL
        AND (ci.profile_synced_at IS NULL OR ci.profile_synced_at<now()-interval '24 hours')
        AND (ci.profile_error_at IS NULL OR ci.profile_error_at<now()-interval '15 minutes')
      ORDER BY ci.profile_synced_at NULLS FIRST,ci.updated_at
      LIMIT $1`,
    [limit],
  );
  let updated = 0;
  let failed = 0;
  let pageProfiles = 0;
  const pageSynced = new Set<string>();
  for (const candidate of candidates.rows) {
    const cfg = await getChannel(candidate.tenant_id, "facebook");
    if (!cfg?.active || !cfg.access_token) continue;
    if (!pageSynced.has(candidate.tenant_id)) {
      pageSynced.add(candidate.tenant_id);
      const page: Awaited<ReturnType<typeof syncFacebookPageProfile>> =
        await syncFacebookPageProfile(candidate.tenant_id, cfg.external_account_id, cfg.access_token)
          .catch(() => ({ ok: false }));
      if (page.ok && !page.skipped) pageProfiles += 1;
    }
    try {
      const result = await syncFacebookUserProfile(candidate.tenant_id, candidate.external_ref, cfg.access_token);
      if (result.ok && !result.skipped) updated += 1;
      else if (!result.skipped) failed += 1;
      for (const conversationId of result.conversationIds) {
        notifyInboxConversationChanged(candidate.tenant_id, conversationId, "CONVERSATION_CHANGED");
      }
    } catch {
      failed += 1;
    }
  }
  return { attempted: candidates.rows.length, updated, failed, pageProfiles };
}
