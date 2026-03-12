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

export const phoneResolvers = {
  Query: {
    phoneSafetyStatus: async (_: any, { phone }: { phone: string }, ctx: any) => {
      const auth = requireAuth(ctx, { optionalWeb: true, optionalAndroid: true });
      const userId = asUserId(auth.author_id);

      const norm = normalizePhone(phone);
      if (!norm) throw new GraphQLError("Invalid phone");

      return getPhoneSafetyStatus(userId, norm, phone);
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
  },

  Mutation: {
    blockPhone: async (_: any, { input }: any, ctx: any) => {
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
    },

    unblockPhone: async (_: any, { input }: any, ctx: any) => {
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
    },
  },
};
