import { GraphQLError } from "graphql/error";

import { requireAuth } from "@/lib/auth";
import { query, runInTransaction } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { pubsub } from "@/lib/pubsub";

import {
  topicMyContactSpamMarkChanged,
  topicMyContactSpamSettingsChanged,
  type MyContactSpamMarkChangedPayload,
  type MyContactSpamSettingsChangedPayload,
} from "../../../packages/graphql-core/src/contactSpamSync";

type ContactProtectionMode = "OFF" | "PROMPT" | "AUTO";
type ContactMarkSource = "MANUAL" | "SUGGESTED" | "AUTO";

const DEFAULT_SETTINGS = {
  mode: "PROMPT" as ContactProtectionMode,
  risk_threshold: 75,
  sync_enabled: true,
  auto_mark_enabled: false,
};

function asUserId(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return null;
}

function normalizeMode(value: unknown): ContactProtectionMode {
  const mode = String(value || "").trim().toUpperCase();
  if (mode === "OFF" || mode === "AUTO") return mode;
  return "PROMPT";
}

function normalizeSource(value: unknown): ContactMarkSource {
  const source = String(value || "").trim().toUpperCase();
  if (source === "SUGGESTED" || source === "AUTO") return source;
  return "MANUAL";
}

function clampThreshold(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.risk_threshold;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function shapeSettings(row: any): MyContactSpamSettingsChangedPayload {
  return {
    user_id: String(row?.user_id || ""),
    mode: normalizeMode(row?.mode),
    risk_threshold: clampThreshold(row?.risk_threshold),
    sync_enabled: row?.sync_enabled !== false,
    auto_mark_enabled: row?.auto_mark_enabled === true,
    updated_at: row?.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  };
}

function shapeMark(row: any, fallbackUserId?: string): MyContactSpamMarkChangedPayload {
  return {
    user_id: String(row?.user_id || fallbackUserId || ""),
    action: row?.deleted_at ? "UNMARK" : "MARK",
    phone_normalized: normalizePhone(String(row?.phone_normalized || "")),
    contact_name: row?.contact_name ? String(row.contact_name) : null,
    source: row?.source ? String(row.source) : null,
    active: !row?.deleted_at,
    updated_at: row?.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  };
}

async function getSettings(userId: string): Promise<MyContactSpamSettingsChangedPayload> {
  const res = await query(
    `
    SELECT user_id, mode, risk_threshold, sync_enabled, auto_mark_enabled, updated_at
    FROM user_contact_spam_settings
    WHERE user_id = $1::uuid
    LIMIT 1
    `,
    [userId]
  );

  if (!res.rows?.[0]) {
    return {
      user_id: userId,
      ...DEFAULT_SETTINGS,
      updated_at: new Date().toISOString(),
    };
  }

  return shapeSettings(res.rows[0]);
}

export const contactSpamResolvers = {
  Query: {
    myContactSpamProtectionSettings: async (_: any, _args: any, ctx: any) => {
      const auth = requireAuth(ctx);
      const userId = asUserId(auth.author_id);
      if (!userId) throw new GraphQLError("Unauthorized");
      return getSettings(userId);
    },

    myContactSpamMarkedPhoneKeys: async (_: any, _args: any, ctx: any) => {
      const auth = requireAuth(ctx);
      const userId = asUserId(auth.author_id);
      if (!userId) throw new GraphQLError("Unauthorized");

      const res = await query(
        `
        SELECT phone_normalized
        FROM user_contact_spam_marks
        WHERE user_id = $1::uuid
          AND deleted_at IS NULL
        ORDER BY updated_at DESC
        `,
        [userId]
      );

      return (res.rows || [])
        .map((row: any) => normalizePhone(String(row?.phone_normalized || "")))
        .filter(Boolean);
    },
  },

  Mutation: {
    updateMyContactSpamProtectionSettings: async (_: any, { input }: any, ctx: any) => {
      const auth = requireAuth(ctx);
      const userId = asUserId(auth.author_id);
      if (!userId) throw new GraphQLError("Unauthorized");

      const mode = normalizeMode(input?.mode);
      const riskThreshold = clampThreshold(input?.risk_threshold);
      const syncEnabled = input?.sync_enabled !== false;
      const autoMarkEnabled = input?.auto_mark_enabled === true;

      const row = await runInTransaction(userId, async (client) => {
        const res = await client.query(
          `
          INSERT INTO user_contact_spam_settings (
            user_id,
            mode,
            risk_threshold,
            sync_enabled,
            auto_mark_enabled,
            updated_at
          )
          VALUES ($1::uuid, $2, $3, $4, $5, now())
          ON CONFLICT (user_id)
          DO UPDATE SET
            mode = EXCLUDED.mode,
            risk_threshold = EXCLUDED.risk_threshold,
            sync_enabled = EXCLUDED.sync_enabled,
            auto_mark_enabled = EXCLUDED.auto_mark_enabled,
            updated_at = now()
          RETURNING user_id, mode, risk_threshold, sync_enabled, auto_mark_enabled, updated_at
          `,
          [userId, mode, riskThreshold, syncEnabled, autoMarkEnabled]
        );
        return res.rows[0];
      });

      const payload = shapeSettings(row);
      await pubsub.publish(topicMyContactSpamSettingsChanged(userId), {
        myContactSpamSettingsChanged: payload,
      });

      return payload;
    },

    markContactSpamPhone: async (_: any, { phone, contact_name, source }: any, ctx: any) => {
      const auth = requireAuth(ctx);
      const userId = asUserId(auth.author_id);
      if (!userId) throw new GraphQLError("Unauthorized");

      const phoneNormalized = normalizePhone(String(phone || ""));
      if (!phoneNormalized) throw new GraphQLError("Invalid phone");

      const row = await runInTransaction(userId, async (client) => {
        const res = await client.query(
          `
          INSERT INTO user_contact_spam_marks (
            user_id,
            phone_normalized,
            contact_name,
            source,
            created_at,
            updated_at,
            deleted_at
          )
          VALUES ($1::uuid, $2, $3, $4, now(), now(), NULL)
          ON CONFLICT (user_id, phone_normalized)
          DO UPDATE SET
            contact_name = COALESCE(EXCLUDED.contact_name, user_contact_spam_marks.contact_name),
            source = EXCLUDED.source,
            updated_at = now(),
            deleted_at = NULL
          RETURNING user_id, phone_normalized, contact_name, source, created_at, updated_at, deleted_at
          `,
          [userId, phoneNormalized, contact_name ? String(contact_name).trim() : null, normalizeSource(source)]
        );
        return res.rows[0];
      });

      const payload = { ...shapeMark(row, userId), action: "MARK", active: true };
      await pubsub.publish(topicMyContactSpamMarkChanged(userId), {
        myContactSpamMarkChanged: payload,
      });

      return payload;
    },

    unmarkContactSpamPhone: async (_: any, { phone }: any, ctx: any) => {
      const auth = requireAuth(ctx);
      const userId = asUserId(auth.author_id);
      if (!userId) throw new GraphQLError("Unauthorized");

      const phoneNormalized = normalizePhone(String(phone || ""));
      if (!phoneNormalized) throw new GraphQLError("Invalid phone");

      const row = await runInTransaction(userId, async (client) => {
        const res = await client.query(
          `
          INSERT INTO user_contact_spam_marks (
            user_id,
            phone_normalized,
            source,
            created_at,
            updated_at,
            deleted_at
          )
          VALUES ($1::uuid, $2, 'MANUAL', now(), now(), now())
          ON CONFLICT (user_id, phone_normalized)
          DO UPDATE SET
            updated_at = now(),
            deleted_at = now()
          RETURNING user_id, phone_normalized, contact_name, source, created_at, updated_at, deleted_at
          `,
          [userId, phoneNormalized]
        );
        return res.rows[0];
      });

      const payload = { ...shapeMark(row, userId), action: "UNMARK", active: false };
      await pubsub.publish(topicMyContactSpamMarkChanged(userId), {
        myContactSpamMarkChanged: payload,
      });

      return payload;
    },
  },
};