import { query } from "@/lib/db";

type Cursor = { at: string; sourceOrder: number; id: string };
export type AuditTimelineFilter = {
  actorUserId?: string | null;
  q?: string | null;
  from?: string | null;
  to?: string | null;
  cursor?: string | null;
  limit?: number | null;
};

function parseCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    if (raw.length > 512) throw new Error();
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof value.at !== "string" || !Number.isFinite(Date.parse(value.at)) ||
        ![0, 1].includes(value.sourceOrder) || typeof value.id !== "string" ||
        !/^\d{1,19}$/.test(value.id) || BigInt(value.id) > 9223372036854775807n) throw new Error();
    return value;
  } catch {
    throw new Error("invalid audit cursor");
  }
}

function dateOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("invalid audit date");
  return date.toISOString();
}

export async function listAuditTimeline(tenantId: string | null, filter: AuditTimelineFilter = {}) {
  const actor = filter.actorUserId?.trim() || null;
  if (actor && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actor)) {
    throw new Error("invalid audit actor");
  }
  const q = filter.q?.trim().slice(0, 100) || null;
  const from = dateOrNull(filter.from);
  const to = dateOrNull(filter.to);
  if (from && to && from > to) throw new Error("audit date range is reversed");
  const cursor = parseCursor(filter.cursor);
  const limit = Math.min(Math.max(Number(filter.limit ?? 50) || 50, 1), 100);
  // Both branches are fixed SQL fragments; the tenant value is always bound.
  // Equality / IS NULL lets the security time index serve either scope.
  const securityTenant = tenantId === null ? "s.tenant_id IS NULL" : "s.tenant_id = $1::uuid";
  // A person's flow has no free-text search. Read at most one page from each
  // exact-identity index before resolving display fields or merging streams.
  // This keeps page N independent of how many years that actor has used BMS.
  const actorOnlySql = `WITH business_new AS (
       SELECT id FROM bms_audit_log
        WHERE tenant_id = $1 AND actor_user_id = $2::uuid
          AND $3::text IS NULL
          AND ($4::timestamptz IS NULL OR created_at >= $4::timestamptz)
          AND ($5::timestamptz IS NULL OR created_at < $5::timestamptz)
          AND ($6::timestamptz IS NULL OR (created_at, 1, id) <
               ($6::timestamptz, $7::integer, $8::bigint))
        ORDER BY created_at DESC, id DESC LIMIT $9
     ), business_raw AS (
       SELECT id FROM bms_audit_log
        WHERE tenant_id = $1 AND actor_user_id IS NULL AND actor = $2::text
          AND ($4::timestamptz IS NULL OR created_at >= $4::timestamptz)
          AND ($5::timestamptz IS NULL OR created_at < $5::timestamptz)
          AND ($6::timestamptz IS NULL OR (created_at, 1, id) <
               ($6::timestamptz, $7::integer, $8::bigint))
        ORDER BY created_at DESC, id DESC LIMIT $9
     ), business_prefixed AS (
       SELECT id FROM bms_audit_log
        WHERE tenant_id = $1 AND actor_user_id IS NULL AND actor = 'user:' || $2::text
          AND ($4::timestamptz IS NULL OR created_at >= $4::timestamptz)
          AND ($5::timestamptz IS NULL OR created_at < $5::timestamptz)
          AND ($6::timestamptz IS NULL OR (created_at, 1, id) <
               ($6::timestamptz, $7::integer, $8::bigint))
        ORDER BY created_at DESC, id DESC LIMIT $9
     ), security_ids AS (
       SELECT s.id FROM bms_security_events s
        WHERE ${securityTenant} AND s.actor_user_id = $2::uuid
          AND ($4::timestamptz IS NULL OR s.created_at >= $4::timestamptz)
          AND ($5::timestamptz IS NULL OR s.created_at < $5::timestamptz)
          AND ($6::timestamptz IS NULL OR (s.created_at, 0, s.id) <
               ($6::timestamptz, $7::integer, $8::bigint))
        ORDER BY s.created_at DESC, s.id DESC LIMIT $9
     ), business_ids AS (
       SELECT id FROM business_new UNION ALL SELECT id FROM business_raw
       UNION ALL SELECT id FROM business_prefixed
     ), events AS (
       SELECT a.id, 1 AS source_order, 'BUSINESS'::text AS source,
              COALESCE(u.email, a.actor) AS actor,
              COALESCE(a.actor_user_id, u.id) AS actor_user_id,
              a.action, a.target,
              jsonb_strip_nulls(jsonb_build_object('eventSource', a.source,
                'actorKind', a.actor_kind, 'targetKind', a.target_kind,
                'requestId', a.request_id)) || a.meta AS meta,
              NULL::text AS outcome, a.created_at
         FROM business_ids candidate
         JOIN bms_audit_log a ON a.id = candidate.id
         LEFT JOIN users u ON u.id = $2::uuid
       UNION ALL
       SELECT s.id, 0 AS source_order, 'SECURITY'::text AS source,
              COALESCE(u.email, s.actor_user_id::text) AS actor,
              s.actor_user_id, s.event AS action, NULL::text AS target,
              jsonb_strip_nulls(jsonb_build_object('source', s.source,
                'reasonCode', s.reason_code, 'sessionRef', s.session_ref)) || s.meta AS meta,
              s.outcome, s.created_at
         FROM security_ids candidate
         JOIN bms_security_events s ON s.id = candidate.id
         LEFT JOIN users u ON u.id = s.actor_user_id
     )
     SELECT id, source_order, source, actor, actor_user_id, action, target,
            meta, outcome, created_at
       FROM events
      ORDER BY created_at DESC, source_order DESC, id DESC
      LIMIT $9`;
  const useActorOnly = Boolean(actor && !q);
  const result = await query<{
    id: string; source_order: number; source: string; actor: string | null;
    actor_user_id: string | null; action: string; target: string | null;
    meta: Record<string, unknown>; outcome: string | null; created_at: Date | string;
  }>(
    useActorOnly ? actorOnlySql : `WITH business AS (
       SELECT a.id, 1 AS source_order, 'BUSINESS'::text AS source,
              COALESCE(u.email, a.actor) AS actor,
              COALESCE(a.actor_user_id, u.id) AS actor_user_id,
              a.action, a.target,
              jsonb_strip_nulls(jsonb_build_object('eventSource', a.source,
                'actorKind', a.actor_kind, 'targetKind', a.target_kind,
                'requestId', a.request_id)) || a.meta AS meta,
              NULL::text AS outcome, a.created_at
         FROM bms_audit_log a
         LEFT JOIN users u ON u.id = COALESCE(a.actor_user_id,
           CASE
             WHEN a.actor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               THEN a.actor::uuid
             WHEN a.actor ~* '^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               THEN substring(a.actor from 6)::uuid
             ELSE NULL
           END)
        WHERE a.tenant_id = $1
          AND ($2::uuid IS NULL OR a.actor_user_id = $2::uuid OR
               (a.actor_user_id IS NULL AND
                 (a.actor = $2::text OR a.actor = 'user:' || $2::text)))
          AND ($3::text IS NULL OR COALESCE(u.email, a.actor) ILIKE '%' || $3 || '%'
               OR a.action ILIKE '%' || $3 || '%' OR a.target ILIKE '%' || $3 || '%'
               OR a.meta->>'conversationId' = $3
               OR a.meta->>'resourceId' = $3
               OR a.meta->>'targetTenantId' = $3)
          AND ($4::timestamptz IS NULL OR a.created_at >= $4::timestamptz)
          AND ($5::timestamptz IS NULL OR a.created_at < $5::timestamptz)
          AND ($6::timestamptz IS NULL OR (a.created_at, 1, a.id) <
               ($6::timestamptz, $7::integer, $8::bigint))
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $9
     ), security AS (
       SELECT s.id, 0 AS source_order, 'SECURITY'::text AS source,
              COALESCE(u.email, s.actor_user_id::text) AS actor,
              s.actor_user_id, s.event AS action, NULL::text AS target,
              jsonb_strip_nulls(jsonb_build_object('source', s.source,
                'reasonCode', s.reason_code, 'sessionRef', s.session_ref)) || s.meta AS meta,
              s.outcome, s.created_at
         FROM bms_security_events s
         LEFT JOIN users u ON u.id = s.actor_user_id
        WHERE ${securityTenant}
          AND ($2::uuid IS NULL OR s.actor_user_id = $2::uuid)
          AND ($3::text IS NULL OR COALESCE(u.email, s.actor_user_id::text) ILIKE '%' || $3 || '%'
               OR s.event ILIKE '%' || $3 || '%'
               OR s.meta->>'conversationId' = $3
               OR s.meta->>'resourceId' = $3
               OR s.meta->>'targetTenantId' = $3)
          AND ($4::timestamptz IS NULL OR s.created_at >= $4::timestamptz)
          AND ($5::timestamptz IS NULL OR s.created_at < $5::timestamptz)
          AND ($6::timestamptz IS NULL OR (s.created_at, 0, s.id) <
               ($6::timestamptz, $7::integer, $8::bigint))
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT $9
     )
     SELECT id, source_order, source, actor, actor_user_id, action, target,
            meta, outcome, created_at
       FROM (SELECT * FROM business UNION ALL SELECT * FROM security) events
      ORDER BY created_at DESC, source_order DESC, id DESC
      LIMIT $9`,
    [tenantId, actor, q, from, to, cursor?.at ?? null,
      cursor?.sourceOrder ?? null, cursor?.id ?? null, limit + 1]
  );
  const rows = result.rows.slice(0, limit).map((row) => ({
    ...row,
    id: `${row.source}:${row.id}`,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  }));
  const last = result.rows[limit - 1];
  const nextCursor = result.rows.length > limit && last
    ? Buffer.from(JSON.stringify({
        at: last.created_at instanceof Date ? last.created_at.toISOString() : last.created_at,
        sourceOrder: last.source_order, id: String(last.id),
      }), "utf8").toString("base64url")
    : null;
  return { nodes: rows, nextCursor };
}
