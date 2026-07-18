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

export type LineProfileSyncResult = {
  ok: boolean;
  skipped?: "missing-token" | "missing-user" | "fresh";
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
const FETCH_TIMEOUT_MS = 900;

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
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
    if (!resp.ok) {
      return { ok: false, status: resp.status, detail: text.slice(0, 300) || resp.statusText };
    }
    return { ok: true, profile: JSON.parse(text || "{}") as LineProfile };
  } catch (error: any) {
    return { ok: false, status: 0, detail: error?.name === "AbortError" ? "timeout" : String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

async function recordProfileError(tenantId: string, userId: string, detail: string): Promise<string[]> {
  const updated = await query<{ id: string }>(
    `UPDATE bms_customer_identities
        SET profile_error_at = now(),
            profile_error = $4,
            updated_at = now()
      WHERE tenant_id = $1 AND channel = 'line' AND external_ref = $2
      RETURNING (
        SELECT c.id
          FROM bms_conversations c
         WHERE c.tenant_id = $1 AND c.channel = 'line' AND c.customer_ref = $2
         LIMIT 1
      ) AS id`,
    [tenantId, userId, detail.slice(0, 300)]
  );
  return updated.rows.map((r) => r.id).filter(Boolean);
}

async function upsertLineProfile(
  tenantId: string,
  userId: string,
  profile: LineProfile
): Promise<string[]> {
  const displayName = cleanText(profile.displayName, 255) || userId;
  const pictureUrl = cleanText(profile.pictureUrl, 1000);
  const statusMessage = cleanText(profile.statusMessage, 500);
  const language = cleanText(profile.language, 32);

  const client = await getClient();
  try {
    await beginTenantTx(client, tenantId);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${tenantId}:line:${userId}`]);

    const existing = await client.query<{ customer_id: string }>(
      `SELECT customer_id
         FROM bms_customer_identities
        WHERE tenant_id = $1 AND channel = 'line' AND external_ref = $2
        FOR UPDATE`,
      [tenantId, userId]
    );

    let customerId = existing.rows[0]?.customer_id ?? null;
    if (!customerId) {
      const cust = await client.query<{ id: string }>(
        `INSERT INTO bms_customers (tenant_id, name, tags)
         VALUES ($1, $2, ARRAY['ลูกค้าใหม่'])
         RETURNING id`,
        [tenantId, displayName]
      );
      customerId = cust.rows[0].id;
    }

    await client.query(
      `INSERT INTO bms_customer_identities
         (tenant_id, customer_id, channel, external_ref, display_name, picture_url, status_message, language,
          profile_synced_at, profile_error_at, profile_error, updated_at)
       VALUES ($1, $2, 'line', $3, $4, $5, $6, $7, now(), NULL, NULL, now())
       ON CONFLICT (tenant_id, channel, external_ref) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          picture_url = EXCLUDED.picture_url,
          status_message = EXCLUDED.status_message,
          language = EXCLUDED.language,
          profile_synced_at = now(),
          profile_error_at = NULL,
          profile_error = NULL,
          updated_at = now()`,
      [tenantId, customerId, userId, displayName, pictureUrl, statusMessage, language]
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
  if (!accessToken) return { ok: false, skipped: "missing-token", conversationIds: [] };

  const cached = await query<{ profile_synced_at: Date | string | null }>(
    `SELECT profile_synced_at
       FROM bms_customer_identities
      WHERE tenant_id = $1 AND channel = 'line' AND external_ref = $2
      LIMIT 1`,
    [tenantId, userId]
  );
  if (cached.rows[0]?.profile_synced_at && shouldSkipFresh(cached.rows[0].profile_synced_at)) {
    return { ok: true, skipped: "fresh", conversationIds: [] };
  }

  const fetched = await fetchLineProfile(accessToken, userId);
  if (!fetched.ok) {
    const conversationIds = await recordProfileError(tenantId, userId, fetched.detail).catch(() => []);
    return { ok: false, status: fetched.status, error: fetched.detail, conversationIds };
  }

  const conversationIds = await upsertLineProfile(tenantId, userId, fetched.profile);
  return { ok: true, conversationIds };
}
