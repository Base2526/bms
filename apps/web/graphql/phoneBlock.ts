// ===== resolvers/phoneBlock.ts =====
import { GraphQLError } from "graphql/error";
import { query, runInTransaction } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { pubsub } from "@/lib/pubsub";

import {
  topicMyPhoneBlockStatusChanged,
  type MyPhoneBlockStatusChangedPayload,
} from "../../../packages/graphql-core/src/blockSync";

function legacyNormalizePhone(raw: string): string {
  if (!raw) return "";
  const digits = String(raw).replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("66") && digits.length === 11) return "0" + digits.slice(2);
  return digits;
}

function phoneNormVariants(phoneRaw: string): { canonical: string; variants: string[] } {
  const canonical = normalizePhone(phoneRaw);
  const legacy = legacyNormalizePhone(phoneRaw);
  const variants = Array.from(new Set([canonical, legacy].filter(Boolean)));
  return { canonical, variants };
}

function isValidLogType(v: any): v is "call" | "sms" {
  return v === "call" || v === "sms";
}

function isValidLogSource(v: any): v is "self" | "community" | "unknown" {
  return v === "self" || v === "community" || v === "unknown";
}

function isValidLogAction(v: any): v is "blocked_call" | "spam_warning" | "allowed" {
  return v === "blocked_call" || v === "spam_warning" || v === "allowed";
}

async function insertCallHistoryLogDedup(
  client: any,
  args: {
    userId: string;
    normalizedNumber: string;
    type: "call" | "sms";
    source: "self" | "community" | "unknown";
    action: "blocked_call" | "spam_warning" | "allowed";
    matchedBy?: string | null;
    createdAt?: string | null;
    dedupWindowSec?: number;
  }
) {
  const dedupWindowSec = Math.max(5, Math.min(Number(args.dedupWindowSec ?? 25), 120));

  // Best-effort dedup: ignore the same event within a short window.
  const existed = await client.query(
    `
    SELECT 1
    FROM call_history_logs
    WHERE user_id = $1::uuid
      AND normalized_number = $2
      AND type = $3
      AND source = $4
      AND action = $5
      AND created_at > now() - ($6 || ' seconds')::interval
    LIMIT 1
    `,
    [
      args.userId,
      args.normalizedNumber,
      args.type,
      args.source,
      args.action,
      String(dedupWindowSec),
    ]
  );

  if (existed.rows?.[0]) return;

  await client.query(
    `
    INSERT INTO call_history_logs
      (user_id, normalized_number, type, source, action, matched_by, created_at)
    VALUES
      ($1::uuid, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()))
    `,
    [
      args.userId,
      args.normalizedNumber,
      args.type,
      args.source,
      args.action,
      args.matchedBy ?? null,
      args.createdAt ?? null,
    ]
  );
}

function asUserId(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return null;
}

function toIsoOrNull(v: any) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

type PhoneCenterFilter = "ALL" | "BLOCKED" | "REPORTS" | "HISTORY";
type RelatedPostsSort = "LATEST" | "HIGHEST_RISK" | "MOST_REPORTED";

function buildPhoneCenterFilters(item: {
  my_blocked?: boolean;
  my_reported?: boolean;
  in_history?: boolean;
}) {
  const filters = ["ALL"];
  if (item.my_blocked) filters.push("BLOCKED");
  if (item.my_reported) filters.push("REPORTS");
  if (item.in_history) filters.push("HISTORY");
  return filters;
}

function mapPhoneCenterRow(row: any) {
  const item = {
    phone: String(row?.phone || row?.phone_normalized || ""),
    phone_normalized: String(row?.phone_normalized || ""),
    my_blocked: !!row?.my_blocked,
    my_blocked_at: toIsoOrNull(row?.my_blocked_at),
    my_reported: !!row?.my_reported,
    my_reported_at: toIsoOrNull(row?.my_reported_at),
    in_history: !!row?.in_history,
    last_history_at: toIsoOrNull(row?.last_history_at),
    report_count: Number(row?.report_count || 0),
    last_report_at: toIsoOrNull(row?.last_report_at),
    risk_level: Number(row?.risk_level || 0),
    updated_at: toIsoOrNull(row?.updated_at) || new Date().toISOString(),
    post_count: Number(row?.post_count || 0),
    latest_post_id: row?.latest_post_id ? String(row.latest_post_id) : null,
    post_ids: Array.isArray(row?.post_ids) ? row.post_ids.map((value: any) => String(value)) : [],
  };

  return {
    ...item,
    filters: buildPhoneCenterFilters(item),
  };
}

function normalizeRelatedPostsSort(value: any): RelatedPostsSort {
  const next = String(value || "LATEST").toUpperCase();
  if (next === "HIGHEST_RISK" || next === "MOST_REPORTED") return next;
  return "LATEST";
}

function buildRelatedPostsOrder(sort: RelatedPostsSort) {
  if (sort === "HIGHEST_RISK") {
    return "metrics.max_risk DESC, metrics.total_reports DESC, p.created_at DESC";
  }
  if (sort === "MOST_REPORTED") {
    return "metrics.total_reports DESC, metrics.max_risk DESC, p.created_at DESC";
  }
  return "p.created_at DESC";
}

async function getPhonePostMeta(phoneRaw: string) {
  const { variants } = phoneNormVariants(phoneRaw);
  if (!variants.length) {
    return { post_ids: [] as string[], post_count: 0, latest_post_id: null as string | null };
  }

  const res = await query(
    `
    SELECT linked.post_id::text AS post_id
    FROM (
      SELECT t.post_id, MAX(p.created_at) AS created_at
      FROM post_tel_numbers t
      JOIN posts p ON p.id = t.post_id
      WHERE t.tel = ANY($1::text[])
        AND p.status = 'public'
      GROUP BY t.post_id
    ) linked
    ORDER BY linked.created_at DESC
    `,
    [variants]
  );

  const postIds = (res.rows || []).map((row: any) => String(row.post_id)).filter(Boolean);
  return {
    post_ids: postIds,
    post_count: postIds.length,
    latest_post_id: postIds[0] ?? null,
  };
}

async function listRelatedPostIdsByPhone(phoneRaw: string, sortValue: any) {
  const { variants } = phoneNormVariants(phoneRaw);
  if (!variants.length) return [];

  const sort = normalizeRelatedPostsSort(sortValue);
  const orderBy = buildRelatedPostsOrder(sort);
  const res = await query(
    `
    SELECT p.id::text AS id
    FROM posts p
    JOIN post_tel_numbers matched_tel
      ON matched_tel.post_id = p.id
     AND matched_tel.tel = ANY($1::text[])
    LEFT JOIN LATERAL (
      SELECT
        GREATEST(
          COALESCE((
            SELECT MAX(sp.risk_level)
            FROM post_tel_numbers t2
            JOIN scam_phones_summary sp ON sp.phone = t2.tel
            WHERE t2.post_id = p.id
          ), 0),
          COALESCE((
            SELECT MAX(sb.risk_level)
            FROM post_seller_accounts sa2
            JOIN scam_bank_accounts_summary sb
              ON sb.bank_name = sa2.bank_name
             AND sb.account_norm = regexp_replace(COALESCE(sa2.seller_account, ''), '[^0-9]', '', 'g')
            WHERE sa2.post_id = p.id
          ), 0)
        )::int AS max_risk,
        (
          COALESCE((
            SELECT SUM(sp.report_count)
            FROM post_tel_numbers t2
            JOIN scam_phones_summary sp ON sp.phone = t2.tel
            WHERE t2.post_id = p.id
          ), 0)
          +
          COALESCE((
            SELECT SUM(sb.report_count)
            FROM post_seller_accounts sa2
            JOIN scam_bank_accounts_summary sb
              ON sb.bank_name = sa2.bank_name
             AND sb.account_norm = regexp_replace(COALESCE(sa2.seller_account, ''), '[^0-9]', '', 'g')
            WHERE sa2.post_id = p.id
          ), 0)
        )::int AS total_reports
    ) metrics ON true
    WHERE p.status = 'public'
    GROUP BY p.id, p.created_at, metrics.max_risk, metrics.total_reports
    ORDER BY ${orderBy}
    `,
    [variants]
  );

  return (res.rows || []).map((row: any) => String(row.id)).filter(Boolean);
}

async function getPhoneInfoRow(phoneRaw: string) {
  const { canonical, variants } = phoneNormVariants(phoneRaw);
  if (!canonical) throw new GraphQLError("Invalid phone");
  const postMeta = await getPhonePostMeta(phoneRaw);

  const res = await query(
    `
    SELECT phone, report_count, last_report_at, risk_level, is_deleted, updated_at
    FROM scam_phones_summary
    WHERE phone = ANY($1::text[])
    ORDER BY CASE WHEN phone = $2 THEN 0 ELSE 1 END, updated_at DESC NULLS LAST
    LIMIT 1
    `,
    [variants, canonical]
  );

  const row = res.rows?.[0];
  return {
    phone: String(row?.phone || canonical),
    report_count: Number(row?.report_count || 0),
    last_report_at: toIsoOrNull(row?.last_report_at),
    risk_level: Number(row?.risk_level || 0),
    tags: [],
    updated_at: toIsoOrNull(row?.updated_at) || new Date().toISOString(),
    is_deleted: !!row?.is_deleted,
    post_ids: postMeta.post_ids,
    ctx: null,
  };
}

// ใช้ดึง status รวม + ของฉัน
async function getPhoneSafetyStatus(
  userId: string | null,
  phoneNorm: string,
  phoneRaw?: string
) {
  const { variants } = phoneNormVariants(phoneRaw || phoneNorm);

  // summary (community)
  // schema_11032026.sql: scam_phones_summary has PK `phone` and does NOT have `phone_normalized`
  // Try normalized first; fallback to raw (for legacy/formatting mismatches).
  let s: any = null;
  {
    const sumRes = await query(
      `SELECT phone, report_count, last_report_at, risk_level, is_deleted, updated_at
       FROM scam_phones_summary
       WHERE phone = $1
       LIMIT 1`,
      [phoneNorm]
    );
    s = sumRes.rows[0] || null;
  }
  if (!s && phoneRaw && phoneRaw !== phoneNorm) {
    const sumRes2 = await query(
      `SELECT phone, report_count, last_report_at, risk_level, is_deleted, updated_at
       FROM scam_phones_summary
       WHERE phone = $1
       LIMIT 1`,
      [String(phoneRaw)]
    );
    s = sumRes2.rows[0] || null;
  }

  // community block (derived from user_blocked_phones; no summary columns exist in schema)
  const blkAgg = await query(
    `SELECT COUNT(DISTINCT user_id)::int AS c, MAX(created_at) AS last_at
     FROM user_blocked_phones
     WHERE phone_normalized = ANY($1::text[])`,
    [variants]
  );
  const blockedByCount = Number(blkAgg.rows?.[0]?.c || 0);
  const lastBlockedAt = blkAgg.rows?.[0]?.last_at || null;

  // my block
  let my: any = null;
  if (userId) {
    const myRes = await query(
      `SELECT created_at
       FROM user_blocked_phones
       WHERE user_id = $1 AND phone_normalized = ANY($2::text[])
       LIMIT 1`,
      [userId, variants]
    );
    my = myRes.rows[0] || null;
  }

  const reportCount = Number(s?.report_count || 0);
  const risk = Number(s?.risk_level ?? (blockedByCount * 4 + reportCount * 6));

  return {
    phone: phoneRaw || phoneNorm,
    phone_normalized: phoneNorm,

    my_blocked: !!my,
    my_blocked_at: my?.created_at ? new Date(my.created_at).toISOString() : null,

    blocked_by_count: blockedByCount,
    last_blocked_at: lastBlockedAt ? new Date(lastBlockedAt).toISOString() : null,

    report_count: reportCount,
    last_report_at: s?.last_report_at ? new Date(s.last_report_at).toISOString() : null,

    risk_level: Math.max(0, Math.min(100, risk)),
    updated_at: s?.updated_at ? new Date(s.updated_at).toISOString() : new Date().toISOString(),
  };
}

async function getPhoneCenterItem(
  userId: string | null,
  phoneNorm: string,
  phoneRaw?: string
) {
  const status = await getPhoneSafetyStatus(userId, phoneNorm, phoneRaw);
  const { variants } = phoneNormVariants(phoneRaw || phoneNorm);
  const postMeta = await getPhonePostMeta(phoneRaw || phoneNorm);

  let myReportedAt: string | null = null;
  let inHistory = false;
  let lastHistoryAt: string | null = null;

  if (userId) {
    const [reportRes, historyRes] = await Promise.all([
      query(
        `
        SELECT MAX(created_at) AS my_reported_at
        FROM scam_phone_reports
        WHERE user_id = $1::uuid
          AND phone_normalized = ANY($2::text[])
        `,
        [userId, variants]
      ),
      query(
        `
        SELECT MAX(created_at) AS last_history_at
        FROM call_history_logs
        WHERE user_id = $1::uuid
          AND normalized_number = ANY($2::text[])
        `,
        [userId, variants]
      ),
    ]);

    myReportedAt = toIsoOrNull(reportRes.rows?.[0]?.my_reported_at);
    lastHistoryAt = toIsoOrNull(historyRes.rows?.[0]?.last_history_at);
    inHistory = !!lastHistoryAt;
  }

  return mapPhoneCenterRow({
    ...status,
    my_reported: !!myReportedAt,
    my_reported_at: myReportedAt,
    in_history: inHistory,
    last_history_at: lastHistoryAt,
    post_count: postMeta.post_count,
    latest_post_id: postMeta.latest_post_id,
    post_ids: postMeta.post_ids,
  });
}

async function reportNumberResolver(args: any, ctx: any) {
  const auth = requireAuth(ctx);
  const userId = asUserId(auth.author_id);
  if (!userId) throw new GraphQLError("Unauthorized");

  const phoneRaw = String(args?.phoneNumber || "");
  const phoneNorm = normalizePhone(phoneRaw);
  if (!phoneNorm) throw new GraphQLError("Invalid phone");
  const category = String(args?.category || "SPAM");
  const note = typeof args?.note === "string" && args.note.trim() ? args.note.trim() : null;

  await runInTransaction(userId, async (client) => {
    await client.query(
      `
      INSERT INTO community_spam_reports (normalized_number, user_id)
      VALUES ($1, $2::uuid)
      `,
      [phoneNorm, userId]
    );

    await client.query(
      `
      INSERT INTO scam_phone_reports
        (user_id, phone, phone_normalized, category, note, client_id, device_model, os_version, app_version, local_blocked)
      VALUES
        ($1::uuid, $2, $3, $4, $5, NULL, NULL, NULL, NULL, false)
      `,
      [userId, phoneRaw || phoneNorm, phoneNorm, category, note]
    );

    await client.query(
      `
      INSERT INTO scam_phones_summary
        (phone, report_count, last_report_at, risk_level, updated_at)
      VALUES
        ($1, 1, now(), 10, now())
      ON CONFLICT (phone)
      DO UPDATE SET
        report_count   = scam_phones_summary.report_count + 1,
        last_report_at = now(),
        risk_level     = GREATEST(COALESCE(scam_phones_summary.risk_level, 0), 10),
        updated_at     = now()
      `,
      [phoneNorm]
    );
  });

  const item = await getPhoneCenterItem(userId, phoneNorm, phoneRaw);
  return { ok: true, item };
}

async function blockPhoneResolver(_parent: any, { input }: any, ctx: any) {
  const auth = requireAuth(ctx);
  const userId = asUserId(auth.author_id);
  if (!userId) throw new GraphQLError("Unauthorized");

  const phoneRaw = String(input?.phone || "");
  const { canonical: phoneNorm, variants } = phoneNormVariants(phoneRaw);
  if (!phoneNorm) throw new GraphQLError("Invalid phone");

  await runInTransaction(userId, async (client) => {
    // Avoid creating duplicate semantic blocks when legacy normalization exists.
    const existed = await client.query(
      `
      SELECT 1
      FROM user_blocked_phones
      WHERE user_id = $1 AND phone_normalized = ANY($2::text[])
      LIMIT 1
      `,
      [userId, variants]
    );
    if (existed.rows?.[0]) return;

    await client.query(
      `
      INSERT INTO user_blocked_phones (user_id, phone, phone_normalized)
      VALUES ($1,$2,$3)
      ON CONFLICT (user_id, phone_normalized) DO NOTHING
      `,
      [userId, phoneRaw, phoneNorm]
    );

    // Spec-required table (write-through, additive)
    await client.query(
      `
      INSERT INTO user_blocked_numbers (user_id, normalized_number)
      VALUES ($1::uuid, $2)
      ON CONFLICT (user_id, normalized_number) DO NOTHING
      `,
      [userId, phoneNorm]
    );
  });

  const status = await getPhoneSafetyStatus(userId, phoneNorm, phoneRaw);

  // Publish AFTER commit only (runInTransaction resolved)
  try {
    const payload: MyPhoneBlockStatusChangedPayload = {
      user_id: userId,
      action: "BLOCK",
      phone: phoneRaw,
      phone_normalized: phoneNorm,
      blocked: true,
      updated_at: status?.my_blocked_at || new Date().toISOString(),
    };
    await pubsub.publish(topicMyPhoneBlockStatusChanged(userId), {
      myPhoneBlockStatusChanged: payload,
    });
  } catch (e) {
    // Subscription is best-effort; source of truth is DB.
    console.warn("[blockPhone] publish myPhoneBlockStatusChanged failed", e);
  }

  return { ok: true, status };
}

async function unblockPhoneResolver(_parent: any, { input }: any, ctx: any) {
  const auth = requireAuth(ctx);
  const userId = asUserId(auth.author_id);
  if (!userId) throw new GraphQLError("Unauthorized");

  const phoneRaw = String(input?.phone || "");
  const { canonical: phoneNorm, variants } = phoneNormVariants(phoneRaw);
  if (!phoneNorm) throw new GraphQLError("Invalid phone");

  await runInTransaction(userId, async (client) => {
    await client.query(
      `
      DELETE FROM user_blocked_phones
      WHERE user_id = $1 AND phone_normalized = ANY($2::text[])
      `,
      [userId, variants]
    );

    // Spec-required table (write-through, additive)
    await client.query(
      `
      DELETE FROM user_blocked_numbers
      WHERE user_id = $1::uuid AND normalized_number = ANY($2::text[])
      `,
      [userId, variants]
    );
  });

  const status = await getPhoneSafetyStatus(userId, phoneNorm, phoneRaw);

  // Publish AFTER commit only
  try {
    const payload: MyPhoneBlockStatusChangedPayload = {
      user_id: userId,
      action: "UNBLOCK",
      phone: phoneRaw,
      phone_normalized: phoneNorm,
      blocked: false,
      updated_at: new Date().toISOString(),
    };
    await pubsub.publish(topicMyPhoneBlockStatusChanged(userId), {
      myPhoneBlockStatusChanged: payload,
    });
  } catch (e) {
    console.warn("[unblockPhone] publish myPhoneBlockStatusChanged failed", e);
  }

  return { ok: true, status };
}

export const phoneResolvers = {
  Query: {
    phoneSafetyStatus: async (_: any, { phone }: { phone: string }, ctx: any) => {
      const auth = requireAuth(ctx, { optionalWeb: true, optionalAndroid: true });
      const userId = asUserId(auth.author_id);

      const norm = normalizePhone(phone);
      if (!norm) throw new GraphQLError("Invalid phone");

      return getPhoneSafetyStatus(userId, norm, phone);
    },

    getPhoneInfo: async (_: any, { phone }: { phone: string }, _ctx: any) => {
      return getPhoneInfoRow(phone);
    },

    phoneDetail: async (_: any, { phone }: { phone: string }, ctx: any) => {
      const auth = requireAuth(ctx, { optionalWeb: true, optionalAndroid: true });
      const userId = asUserId(auth.author_id);
      const norm = normalizePhone(phone);
      if (!norm) throw new GraphQLError("Invalid phone");

      return getPhoneCenterItem(userId, norm, phone);
    },

    relatedPostsByPhone: async (_: any, { phone, sort }: { phone: string; sort?: RelatedPostsSort }, _ctx: any) => {
      return listRelatedPostIdsByPhone(phone, sort);
    },

    phoneCenterSearch: async (
      _: any,
      { q, filter = "ALL", limit = 50, offset = 0 }: any,
      ctx: any
    ) => {
      const auth = requireAuth(ctx, { optionalWeb: true, optionalAndroid: true });
      const userId = asUserId(auth.author_id);
      const safeFilter = String(filter || "ALL").toUpperCase() as PhoneCenterFilter;
      const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
      const safeOffset = Math.max(Number(offset) || 0, 0);
      const rawQuery = typeof q === "string" ? q.trim() : "";
      const normalizedQuery = normalizePhone(rawQuery);
      const likeTerm = `%${normalizedQuery || rawQuery}%`;

      if (!userId && !rawQuery) return [];
      if (!userId && safeFilter !== "ALL") return [];

      const candidateParts: string[] = [];
      const params: any[] = [];
      const pushParam = (value: any) => {
        params.push(value);
        return `$${params.length}`;
      };

      if (rawQuery) {
        const likeParam = pushParam(likeTerm);
        candidateParts.push(
          `SELECT phone AS phone_normalized FROM scam_phones_summary WHERE phone ILIKE ${likeParam}::text`
        );

        if (userId) {
          const userParam = pushParam(userId);

          if (safeFilter === "ALL" || safeFilter === "BLOCKED") {
            const blockedLikeParam = pushParam(likeTerm);
            candidateParts.push(
              `SELECT phone_normalized FROM user_blocked_phones WHERE user_id = ${userParam}::uuid AND (phone_normalized ILIKE ${blockedLikeParam}::text OR phone ILIKE ${blockedLikeParam}::text)`
            );
          }
          if (safeFilter === "ALL" || safeFilter === "REPORTS") {
            const reportLikeParam = pushParam(likeTerm);
            candidateParts.push(
              `SELECT phone_normalized FROM scam_phone_reports WHERE user_id = ${userParam}::uuid AND (phone_normalized ILIKE ${reportLikeParam}::text OR phone ILIKE ${reportLikeParam}::text)`
            );
          }
          if (safeFilter === "ALL" || safeFilter === "HISTORY") {
            const historyLikeParam = pushParam(likeTerm);
            candidateParts.push(
              `SELECT normalized_number AS phone_normalized FROM call_history_logs WHERE user_id = ${userParam}::uuid AND normalized_number ILIKE ${historyLikeParam}::text`
            );
          }
        }
      } else if (userId) {
        const userParam = pushParam(userId);
        if (safeFilter === "ALL" || safeFilter === "BLOCKED") {
          candidateParts.push(
            `SELECT phone_normalized FROM user_blocked_phones WHERE user_id = ${userParam}::uuid`
          );
        }
        if (safeFilter === "ALL" || safeFilter === "REPORTS") {
          candidateParts.push(
            `SELECT phone_normalized FROM scam_phone_reports WHERE user_id = ${userParam}::uuid`
          );
        }
        if (safeFilter === "ALL" || safeFilter === "HISTORY") {
          candidateParts.push(
            `SELECT normalized_number AS phone_normalized FROM call_history_logs WHERE user_id = ${userParam}::uuid`
          );
        }
      }

      if (!candidateParts.length) return [];

      const userJoinParam = userId ? pushParam(userId) : null;
      const exactParam = rawQuery ? pushParam(normalizedQuery || rawQuery) : null;
      const limitParam = pushParam(safeLimit);
      const offsetParam = pushParam(safeOffset);

      const filterWhere =
        safeFilter === "BLOCKED"
          ? "WHERE aggregated.my_blocked = true"
          : safeFilter === "REPORTS"
          ? "WHERE aggregated.my_reported = true"
          : safeFilter === "HISTORY"
          ? "WHERE aggregated.in_history = true"
          : "";

      const userJoin = userJoinParam
        ? `
        LEFT JOIN user_blocked_phones ub
          ON ub.user_id = ${userJoinParam}::uuid
         AND ub.phone_normalized = c.phone_normalized
        LEFT JOIN scam_phone_reports sr
          ON sr.user_id = ${userJoinParam}::uuid
         AND sr.phone_normalized = c.phone_normalized
        LEFT JOIN call_history_logs ch
          ON ch.user_id = ${userJoinParam}::uuid
         AND ch.normalized_number = c.phone_normalized
        `
        : `
        LEFT JOIN user_blocked_phones ub ON false
        LEFT JOIN scam_phone_reports sr ON false
        LEFT JOIN call_history_logs ch ON false
        `;

      const exactOrder = exactParam
        ? `CASE WHEN aggregated.phone_normalized = ${exactParam}::text THEN 0 ELSE 1 END,`
        : "";

      console.info("[phoneCenterSearch] params", {
        hasUser: Boolean(userId),
        safeFilter,
        rawQuery,
        normalizedQuery,
        safeLimit,
        safeOffset,
        candidateCount: candidateParts.length,
      });

      const res = await query(
        `
        WITH candidates AS (
          SELECT DISTINCT phone_normalized
          FROM (
            ${candidateParts.join("\n            UNION\n")}
          ) candidate_rows
          WHERE COALESCE(phone_normalized, '') <> ''
        ),
        aggregated AS (
          SELECT
            c.phone_normalized,
            COALESCE(
              MAX(ub.phone) FILTER (WHERE ub.phone IS NOT NULL AND ub.phone <> ''),
              MAX(sr.phone) FILTER (WHERE sr.phone IS NOT NULL AND sr.phone <> ''),
              c.phone_normalized
            ) AS phone,
            BOOL_OR(ub.user_id IS NOT NULL) AS my_blocked,
            MAX(ub.created_at) AS my_blocked_at,
            BOOL_OR(sr.user_id IS NOT NULL) AS my_reported,
            MAX(sr.created_at) AS my_reported_at,
            BOOL_OR(ch.id IS NOT NULL) AS in_history,
            MAX(ch.created_at) AS last_history_at,
            COALESCE(MAX(s.report_count), 0)::int AS report_count,
            MAX(s.last_report_at) AS last_report_at,
            COALESCE(MAX(s.risk_level), 0)::int AS risk_level,
            linked.post_count AS post_count,
            linked.latest_post_id AS latest_post_id,
            linked.post_ids AS post_ids,
            COALESCE(
              MAX(s.updated_at),
              GREATEST(MAX(ub.created_at), MAX(sr.created_at), MAX(ch.created_at), now())
            ) AS updated_at
          FROM candidates c
          LEFT JOIN scam_phones_summary s
            ON s.phone = c.phone_normalized
          LEFT JOIN LATERAL (
            SELECT
              COALESCE(array_agg(lp.post_id::text ORDER BY lp.created_at DESC), ARRAY[]::text[]) AS post_ids,
              COUNT(*)::int AS post_count,
              (array_agg(lp.post_id::text ORDER BY lp.created_at DESC))[1] AS latest_post_id
            FROM (
              SELECT t.post_id, MAX(p.created_at) AS created_at
              FROM post_tel_numbers t
              JOIN posts p ON p.id = t.post_id
              WHERE t.tel = c.phone_normalized
                AND p.status = 'public'
              GROUP BY t.post_id
            ) lp
          ) linked ON true
          ${userJoin}
          GROUP BY c.phone_normalized, linked.post_count, linked.latest_post_id, linked.post_ids
        )
        SELECT *
        FROM aggregated
        ${filterWhere}
        ORDER BY
          ${exactOrder}
          COALESCE(aggregated.updated_at, aggregated.last_history_at, aggregated.my_reported_at, aggregated.my_blocked_at) DESC,
          aggregated.risk_level DESC,
          aggregated.report_count DESC,
          aggregated.phone_normalized ASC
        LIMIT ${limitParam}::int OFFSET ${offsetParam}::int
        `,
        params
      );

      return (res.rows || []).map(mapPhoneCenterRow);
    },

    myBlockedPhones: async (_: any, { limit = 50, offset = 0 }: any, ctx: any) => {
      const auth = requireAuth(ctx);
      const userId = asUserId(auth.author_id);
      if (!userId) throw new GraphQLError("Unauthorized");

      const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
      const safeOffset = Math.max(Number(offset) || 0, 0);

      const res = await query(
        `
        SELECT
          ub.phone,
          ub.phone_normalized,
          ub.created_at AS my_blocked_at,

          -- derived community block stats (schema has no columns for these)
          COALESCE(b.blocked_by_count, 0) AS blocked_by_count,
          b.last_blocked_at,

          COALESCE(s.report_count, 0) AS report_count,
          s.last_report_at,
          COALESCE(s.risk_level, 0) AS risk_level,
          COALESCE(s.updated_at, now()) AS updated_at
        FROM user_blocked_phones ub
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS blocked_by_count, MAX(created_at) AS last_blocked_at
          FROM user_blocked_phones ub2
          WHERE ub2.phone_normalized = ub.phone_normalized
        ) b ON true
        LEFT JOIN scam_phones_summary s
          ON s.phone = ub.phone_normalized
        WHERE ub.user_id = $1::uuid
        ORDER BY ub.created_at DESC
        LIMIT $2 OFFSET $3
        `,
        [userId, safeLimit, safeOffset]
      );

      return (res.rows || []).map((r: any) => ({
        phone: String(r.phone || ""),
        phone_normalized: String(r.phone_normalized || ""),

        // ของฉัน
        my_blocked: true,
        my_blocked_at: toIsoOrNull(r.my_blocked_at),

        // community block (ตอนนี้ DB ยังไม่มี -> default)
        blocked_by_count: Number(r.blocked_by_count || 0),
        last_blocked_at: toIsoOrNull(r.last_blocked_at),

        // report/community risk
        report_count: Number(r.report_count || 0),
        last_report_at: toIsoOrNull(r.last_report_at),
        risk_level: Number(r.risk_level || 0),
        updated_at: toIsoOrNull(r.updated_at) || new Date().toISOString(),
      }));
    },

    myBlockedPhoneKeys: async (_: any, _args: any, ctx: any) => {
      const auth = requireAuth(ctx);
      const userId = asUserId(auth.author_id);
      if (!userId) throw new GraphQLError("Unauthorized");

      const res = await query(
        `
        SELECT DISTINCT ub.phone_normalized
        FROM user_blocked_phones ub
        WHERE ub.user_id = $1::uuid
        ORDER BY ub.phone_normalized ASC
        `,
        [userId]
      );

      // Normalize output keys to canonical format so clients can rely on one representation.
      return (res.rows || [])
        .map((r: any) => normalizePhone(String(r.phone_normalized || "").trim()))
        .filter(Boolean);
    },

    // =========================
    // Spec-required (additive)
    // =========================
    getUserBlockedNumbers: async (_: any, _args: any, ctx: any) => {
      const auth = requireAuth(ctx);
      const userId = asUserId(auth.author_id);
      if (!userId) throw new GraphQLError("Unauthorized");

      const res = await query(
        `
        SELECT normalized_number
        FROM user_blocked_numbers
        WHERE user_id = $1::uuid
        ORDER BY created_at DESC
        `,
        [userId]
      );

      return (res.rows || [])
        .map((r: any) => normalizePhone(String(r.normalized_number || "").trim()))
        .filter(Boolean);
    },

    getSpamNumbers: async (_: any, { minRisk = 60, limit = 200 }: any, _ctx: any) => {
      const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
      const safeMinRisk = Math.min(Math.max(Number(minRisk) || 60, 0), 100);

      const res = await query(
        `
        SELECT phone, report_count, last_report_at, risk_level, post_ids, is_deleted, updated_at
        FROM scam_phones_summary
        WHERE COALESCE(is_deleted, false) = false
          AND COALESCE(risk_level, 0) >= $1
        ORDER BY risk_level DESC, report_count DESC, updated_at DESC
        LIMIT $2
        `,
        [safeMinRisk, safeLimit]
      );

      return (res.rows || []).map((r: any) => ({
        phone: String(r.phone || ""),
        report_count: Number(r.report_count || 0),
        last_report_at: toIsoOrNull(r.last_report_at),
        risk_level: Number(r.risk_level || 0),
        tags: [],
        updated_at: toIsoOrNull(r.updated_at) || new Date().toISOString(),
        is_deleted: !!r.is_deleted,
        post_ids: Array.isArray(r.post_ids) ? r.post_ids : [],
        ctx: null,
      }));
    },

    getCallLogs: async (_: any, { limit = 100, offset = 0 }: any, ctx: any) => {
      const auth = requireAuth(ctx);
      const userId = asUserId(auth.author_id);
      if (!userId) throw new GraphQLError("Unauthorized");

      const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
      const safeOffset = Math.max(Number(offset) || 0, 0);

      const res = await query(
        `
        SELECT id, normalized_number, type, source, action, matched_by, created_at
        FROM call_history_logs
        WHERE user_id = $1::uuid
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
        `,
        [userId, safeLimit, safeOffset]
      );

      return (res.rows || []).map((r: any) => ({
        id: String(r.id),
        normalized_number: String(r.normalized_number || ""),
        type: String(r.type || ""),
        source: String(r.source || ""),
        action: String(r.action || ""),
        matched_by: r.matched_by != null ? String(r.matched_by) : null,
        created_at: toIsoOrNull(r.created_at) || new Date().toISOString(),
      }));
    },
  },

  Mutation: {
    blockPhone: blockPhoneResolver,

    unblockPhone: unblockPhoneResolver,

    reportPhone: async (_: any, { phone, category, note }: any, ctx: any) => {
      return reportNumberResolver({ phoneNumber: phone, category, note }, ctx);
    },

    // =========================
    // Spec-required (additive)
    // =========================
    blockNumber: async (_: any, { phoneNumber }: any, ctx: any) => {
      const payload = await blockPhoneResolver(_, { input: { phone: String(phoneNumber || ""), note: null, postId: null } }, ctx);
      const item = await getPhoneCenterItem(
        asUserId(requireAuth(ctx).author_id),
        payload?.status?.phone_normalized,
        payload?.status?.phone
      );
      return { ok: true, item };
    },

    unblockNumber: async (_: any, { phoneNumber }: any, ctx: any) => {
      const payload = await unblockPhoneResolver(_, { input: { phone: String(phoneNumber || "") } }, ctx);
      const item = await getPhoneCenterItem(
        asUserId(requireAuth(ctx).author_id),
        payload?.status?.phone_normalized,
        payload?.status?.phone
      );
      return { ok: true, item };
    },

    reportNumber: async (_: any, args: any, ctx: any) => {
      return reportNumberResolver(args, ctx);
    },

    reportSpam: async (_: any, { phoneNumber }: any, ctx: any) => {
      await reportNumberResolver({ phoneNumber, category: "SPAM", note: null }, ctx);
      return true;
    },

    ingestCallLogs: async (_: any, { logs }: any, ctx: any) => {
      const auth = requireAuth(ctx);
      const userId = asUserId(auth.author_id);
      if (!userId) throw new GraphQLError("Unauthorized");

      const list = Array.isArray(logs) ? logs : [];
      if (!list.length) return true;

      await runInTransaction(userId, async (client) => {
        for (const it of list) {
          const phoneNorm = normalizePhone(String(it?.normalized_number || ""));
          if (!phoneNorm) continue;

          const type = String(it?.type || "");
          const source = String(it?.source || "");
          const action = String(it?.action || "");
          if (!isValidLogType(type) || !isValidLogSource(source) || !isValidLogAction(action)) continue;

          const createdAt = it?.created_at ? String(it.created_at) : null;
          const matchedBy = it?.matched_by ? String(it.matched_by) : null;

          await insertCallHistoryLogDedup(client, {
            userId,
            normalizedNumber: phoneNorm,
            type,
            source,
            action,
            matchedBy,
            createdAt,
            dedupWindowSec: 25,
          });
        }
      });

      return true;
    },
  },
};
