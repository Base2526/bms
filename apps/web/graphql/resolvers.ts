import crypto, { randomUUID }  from "crypto";
import { GraphQLError } from "graphql/error";
import bcrypt from 'bcryptjs';
import { query, runInTransaction } from "@/lib/db";
import { pubsub } from "@/lib/pubsub";
import * as jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import path from "path";
import GraphQLJSON from "graphql-type-json";

import { USER_COOKIE, ADMIN_COOKIE, JWT_SECRET } from "@/lib/auth/token";
import { createResetToken, sendPasswordResetEmail } from "@/lib/passwordReset";
import { buildFileUrlById, persistUploadStream } from "@/lib/storage";
import { requireAuth, sha256Hex, generateRawToken } from "@/lib/auth"
import { getTenantName } from "@/lib/bms/platform";
import { addLog } from "@/lib/log/log.server";
import { v4 as uuidv4 } from 'uuid';

import { verifyGoogle, verifyFacebook } from "@/lib/auth/social";
// import { signUserToken } from "@/lib/auth/jwt";

import { GraphQLUpload } from "graphql-upload-nextjs";
import sgMail from "@sendgrid/mail";
import { createNotification } from '@/lib/notifications/service'; 

import { getLatestEmailTemplate, renderEmailTemplate } from "@/lib/emailTemplates";
import { sendEmail } from "@/lib/mailer";

import { emitPostEvent } from "@events/emit.server";
import {
  deactivateDevicePushToken,
  listActiveFcmTokens,
  upsertDevicePushToken,
} from "@/lib/push/deviceTokens";
import { sendFcmChatPush } from "@/lib/push/fcm";

import { phoneResolvers } from "@/graphql/phoneBlock";
import { contactSpamResolvers } from "@/graphql/contactSpam";
import { bmsOrdersResolvers } from "@/graphql/bmsOrders";
import { bmsProductsResolvers } from "@/graphql/bmsProducts";
import { bmsCustomersResolvers } from "@/graphql/bmsCustomers";
import { bmsDashboardResolvers } from "@/graphql/bmsDashboard";
import { bmsChannelsResolvers } from "@/graphql/bmsChannels";
import { bmsAiConfigResolvers } from "@/graphql/bmsAiConfig";
import { bmsSqlConsoleResolvers } from "@/graphql/bmsSqlConsole";
import { bmsSaasResolvers } from "@/graphql/bmsSaas";
import { bmsPurchaseResolvers } from "@/graphql/bmsPurchase";
import { bmsPaymentsResolvers } from "@/graphql/bmsPayments";
import { bmsShippingResolvers } from "@/graphql/bmsShipping";
import { bmsInboxResolvers } from "@/graphql/bmsInbox";
import { bmsReportsResolvers } from "@/graphql/bmsReports";
import { bmsCustomer360Resolvers } from "@/graphql/bmsCustomer360";
import { bmsAssistantResolvers } from "@/graphql/bmsAssistant";
import { bmsStoreProfileResolvers } from "@/graphql/bmsStoreProfile";
import { bmsRevisionsResolvers } from "@/graphql/bmsRevisions";
import { bmsCouponsResolvers } from "@/graphql/bmsCoupons";
import { bmsAiQualityResolvers } from "@/graphql/bmsAiQuality";
import { bmsReportScheduleResolvers } from "@/graphql/bmsReportSchedule";
import { bmsMailLogResolvers } from "@/graphql/bmsMailLog";
import { bmsRestockSubscriptionsResolvers } from "@/graphql/bmsRestockSubscriptions";
import { getTenantId } from "@/lib/bms/tenant";
import { isPlatformAdmin } from "@/lib/bms/platform";
import { enforceUserQuota } from "@/lib/bms/plans";
import { reassignStaffConversations } from "@/lib/bms/inbox";

import { logAsync } from "@/lib/logger";

// =============================================================
// Authz helpers — จัดการผู้ใช้/สิทธิ์ ใน BMS admin
// platform admin เห็น/แก้ได้ทุกร้านเมื่ออยู่มุมแพลตฟอร์ม
// แต่ถ้ากำลัง drill-down/acting tenant ต้องทำตัวเป็น tenant-scoped เพื่อไม่หลุดร้านที่กำลังดู
// =============================================================
async function requireUserAdmin(ctx: any): Promise<{ platform: boolean; tenantId: string }> {
  const auth = requireAuth(ctx);
  if (auth.scope !== "admin") {
    throw new GraphQLError("Admin only", { extensions: { code: "FORBIDDEN", http: { status: 403 } } });
  }
  const actingTenant = !!ctx?.admin?.__actingTenantId;
  const platform = (await isPlatformAdmin(ctx)) && !actingTenant;
  const isSuper = ctx?.admin?.role === "Administrator";
  if (!platform && !isSuper) {
    throw new GraphQLError("เฉพาะผู้ดูแลร้าน (Administrator) หรือแอดมินแพลตฟอร์มเท่านั้น", {
      extensions: { code: "FORBIDDEN", http: { status: 403 } },
    });
  }
  return { platform, tenantId: getTenantId(ctx) };
}

/** gate เฉพาะ platform admin (เช่น จัดการ role กลางทั้งระบบ) */
async function requirePlatformOnly(ctx: any): Promise<void> {
  const auth = requireAuth(ctx);
  if (auth.scope !== "admin" || !(await isPlatformAdmin(ctx))) {
    throw new GraphQLError("เฉพาะแอดมินแพลตฟอร์มเท่านั้น", {
      extensions: { code: "FORBIDDEN", http: { status: 403 } },
    });
  }
}

import { normalizeAccountNo } from "@/lib/phone";
import {
  topicMyBankBlockStatusChanged,
  type MyBankBlockStatusChangedPayload,
} from "../../../packages/graphql-core/src/blockSync";

import {
  topicMyBookmarkStatusChanged,
  type MyBookmarkStatusChangedPayload,
} from "../../../packages/graphql-core/src/bookmarkSync";

export const COMMENT_ADDED = 'COMMENT_ADDED';
export const COMMENT_UPDATED = 'COMMENT_UPDATED';
export const COMMENT_DELETED = 'COMMENT_DELETED';
export const NOTI_CREATED   = 'NOTI_CREATED';

export const INCOMING_MESSAGE  = 'INCOMING_MESSAGE';

sgMail.setApiKey(process.env.NEXT_PUBLIC_SENDGRID_API_KEY!);

// (async () => {
//   const resp = await sgMail.send({
//     to: "android.somkid@gmail.com",
//     from: process.env.NEXT_PUBLIC_SENDGRID_FROM_EMAIL!,
//     subject: "SendGrid test",
//     html: "<b>Hello</b>",
//   });
//   console.log("=====> OK", resp[0].statusCode);
// })();

const isDev = process.env.NODE_ENV !== "production";
const useSecureCookie = process.env.COOKIE_SECURE === "true";

type GraphQLUploadFile = {
  filename: string;
  mimetype?: string | null;
  encoding?: string | null;
  createReadStream: () => NodeJS.ReadableStream;
};

// setInterval(() => {
//   const now = new Date().toISOString();

//   console.log("[appResolvers.ts][TIME_TICK]");
//   pubsub.publish("TIME_TICK", { time: now });

// }, 50000);

const TOKEN_TTL_DAYS = 7;
const topicChat = (chat_id: string) => `MSG_CHAT_${chat_id}`;
const topicUser = (user_id: string) => `MSG_USER_${user_id}`;
type Iso = string;

function normalizeStr(input: string): string {
  return input
    .toLowerCase()              // เป็นตัวเล็ก
    .normalize("NFD")           // แยก accent (รองรับไทย/ภาษายุโรป)
    .replace(/[\u0300-\u036f]/g, "") // ลบ accent
    .replace(/[^a-z0-9]+/g, "_") // อะไรที่ไม่ใช่ a-z 0-9 → _
    .replace(/_+/g, "_")         // แทน _ ซ้อนหลายตัวด้วย _
    .replace(/^_+|_+$/g, "");    // ตัด _ หน้า/หลัง
}

async function getUserById(id: string) {
  const { rows } = await query(
    `SELECT * FROM users WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

function buildLike(term: string) {
  // escape % และ _ กัน LIKE แตก
  return `%${term.replace(/[%_]/g, (m) => "\\" + m)}%`;
}

// ป้องกัน tsquery ระเบิดถ้ามี symbol แปลก
function buildTsQuery(term: string) {
  // ถ้าอยากโหดกว่านี้ แยกเป็น token & join ด้วย AND ก็ได้
  return term
    .trim()
    .replace(/[':]/g, " ") // เอา symbol ที่ tsquery ไม่ชอบออก
    .replace(/\s+/g, " ");
}

// helper
function maskAccount(account: any) {
  if (!account) return "";
  return account.replace(/.(?=.{4})/g, "x");
}

function calcRisk(reportCount: number): number {
  if (reportCount >= 20) return 90;
  if (reportCount >= 10) return 60;
  if (reportCount >= 5)  return 40;
  return 10;
}

function baseData(locale: string) {
  return {
    app_name: process.env.NEXT_PUBLIC_WEB_NAME ?? "Jachoei",
    year: new Date().getFullYear(),
    support_url: process.env.NEXT_PUBLIC_SUPPORT_URL ?? "https://jachoei.com/support",
    locale,
  };
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function mapSupportComment(row: any) {
  return {
    id: String(row.id),
    authorId: row.author_id ? String(row.author_id) : null,
    authorEmail: row.author_email,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    body: row.body,
    createdAt: toIsoOrNull(row.created_at) || new Date(0).toISOString(),
  };
}

function mapSupportTicket(row: any, comments: any[] = []) {
  return {
    id: String(row.id),
    ticketId: row.ticket_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    topic: row.topic,
    subject: row.subject,
    message: row.message,
    ref: row.ref,
    pageUrl: row.page_url,
    userAgent: row.user_agent,
    ip: row.ip,
    status: row.status,
    createdAt: toIsoOrNull(row.created_at) || new Date(0).toISOString(),
    updatedAt: toIsoOrNull(row.updated_at),
    closedAt: toIsoOrNull(row.closed_at),
    comments: comments.map(mapSupportComment),
  };
}

function normalizeTel(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("0") && digits.length === 10) return "66" + digits.slice(1);
  // Canonical: digits only (no leading '+')
  return digits;
}

function normalizePhone(raw: string) {
  const s = String(raw || "").trim();
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("0") && digits.length === 10) return "66" + digits.slice(1);
  // Canonical: digits only (no leading '+')
  return digits;
}

function toIsoOrNull(v: any) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

function uuidArrayToStringArray(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [];
}

function toIso(v: any, fallback?: any) {
  const d1 = v ? new Date(v) : null;
  if (d1 && !Number.isNaN(d1.getTime())) return d1.toISOString();

  const d2 = fallback ? new Date(fallback) : null;
  if (d2 && !Number.isNaN(d2.getTime())) return d2.toISOString();

  return new Date().toISOString();
}

function shapeScamBankAccount(row: any) {
  // DB summary มี: bank_name, account_no, account_norm, report_count, last_report_at, risk_level, updated_at
  return {
    bank_name: String(row?.bank_name || "UNKNOWN"),
    account: String(row?.account_norm || row?.account_no || ""),
    report_count: Number(row?.report_count || 0),
    last_report_at: row?.last_report_at ? new Date(row.last_report_at).toISOString() : null,
    risk_level: Number(row?.risk_level || 0),
    updated_at: row?.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    is_deleted: false,
    post_ids: [],
    ctx: null,
    tags: [],
  };
}

function normalizeBankAccount(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.replace(/[^\d]/g, "");
}

type RelatedPostsSort = "LATEST" | "HIGHEST_RISK" | "MOST_REPORTED";

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

async function getBankPostMeta(bankCode: string, accountNo: string) {
  const bankName = String(bankCode || "").trim() || "UNKNOWN";
  const accountNorm = normalizeBankAccount(accountNo);
  if (!accountNorm) {
    return { post_ids: [] as string[], post_count: 0, latest_post_id: null as string | null };
  }

  const res = await query(
    `
    SELECT linked.post_id::text AS post_id
    FROM (
      SELECT sa.post_id, MAX(p.created_at) AS created_at
      FROM post_seller_accounts sa
      JOIN posts p ON p.id = sa.post_id
      WHERE sa.bank_name = $1
        AND regexp_replace(COALESCE(sa.seller_account, ''), '[^0-9]', '', 'g') = $2
        AND p.status = 'public'
      GROUP BY sa.post_id
    ) linked
    ORDER BY linked.created_at DESC
    `,
    [bankName, accountNorm]
  );

  const postIds = (res.rows || []).map((row: any) => String(row.post_id)).filter(Boolean);
  return {
    post_ids: postIds,
    post_count: postIds.length,
    latest_post_id: postIds[0] ?? null,
  };
}

async function listRelatedPostIdsByBank(bankCode: string, accountNo: string, sortValue: any) {
  const bankName = String(bankCode || "").trim() || "UNKNOWN";
  const accountNorm = normalizeBankAccount(accountNo);
  if (!accountNorm) return [];

  const sort = normalizeRelatedPostsSort(sortValue);
  const orderBy = buildRelatedPostsOrder(sort);
  const res = await query(
    `
    SELECT p.id::text AS id
    FROM posts p
    JOIN post_seller_accounts matched_bank
      ON matched_bank.post_id = p.id
     AND matched_bank.bank_name = $1
     AND regexp_replace(COALESCE(matched_bank.seller_account, ''), '[^0-9]', '', 'g') = $2
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
    [bankName, accountNorm]
  );

  return (res.rows || []).map((row: any) => String(row.id)).filter(Boolean);
}

function serializeError(err: unknown): { name?: string; message?: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  try {
    return { message: JSON.stringify(err) };
  } catch {
    return { message: String(err) };
  }
}

function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[MaxDepth]";
  if (value == null) return value;
  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((v) => redactSecrets(v, depth + 1));
  }

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/password|token|secret|authorization|cookie/i.test(k)) {
      out[k] = "[REDACTED]";
      continue;
    }
    out[k] = redactSecrets(v, depth + 1);
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickValue(source: unknown, key: string): unknown {
  if (!isRecord(source)) return undefined;
  return source[key];
}

function buildResolverMeta(kind: "Query" | "Mutation", name: string, args: unknown, ctx: unknown) {
  const ctxRec = isRecord(ctx) ? ctx : undefined;
  const ctxUser = ctxRec && isRecord(ctxRec.user) ? (ctxRec.user as Record<string, unknown>) : undefined;
  const user_id = (ctxUser?.id ?? ctxRec?.author_id ?? null) as unknown;

  const argsRec = isRecord(args) ? args : undefined;
  const input = argsRec && isRecord(argsRec.input) ? (argsRec.input as Record<string, unknown>) : undefined;
  const source: unknown = input ?? argsRec ?? {};

  const client_id = pickValue(source, "client_id") ?? pickValue(source, "clientId");
  const phone = pickValue(source, "phone");
  const bank_name = pickValue(source, "bank_name") ?? pickValue(source, "bankName");
  const account = pickValue(source, "account") ?? pickValue(source, "account_no") ?? pickValue(source, "account_norm");
  const postId = pickValue(source, "postId") ?? pickValue(source, "post_id");
  const id = pickValue(source, "id");

  const meta: Record<string, unknown> = {
    resolver: `${kind}.${name}`,
    user_id,
    client_id,
    phone,
    bank_name,
    account,
    postId,
    id,
  };

  // strip null/undefined to keep logs tidy
  for (const k of Object.keys(meta)) {
    if (meta[k] == null || meta[k] === "") delete meta[k];
  }

  return meta;
}

function wrapResolverMap(kind: "Query" | "Mutation", map: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(map || {})) {
    if (typeof fn !== "function") {
      out[name] = fn;
      continue;
    }

    out[name] = async (...resolverArgs: unknown[]) => {
      const args = resolverArgs.length >= 2 ? resolverArgs[1] : undefined;
      const ctx = resolverArgs.length >= 3 ? resolverArgs[2] : undefined;
      const start = Date.now();
      const meta = buildResolverMeta(kind, name, args, ctx);

      void logAsync("info", "graphql", `${kind}.${name} called`, meta);
      void logAsync("debug", "graphql", `${kind}.${name} args`, {
        ...meta,
        args: redactSecrets(args),
      });

      try {
        const result = await Promise.resolve((fn as (...a: unknown[]) => unknown)(...resolverArgs));
        void logAsync("info", "graphql", `${kind}.${name} success`, {
          ...meta,
          duration_ms: Date.now() - start,
        });
        return result;
      } catch (err) {
        void logAsync("error", "graphql", `${kind}.${name} failed`, {
          ...meta,
          duration_ms: Date.now() - start,
          error: serializeError(err),
        });
        throw err;
      }
    };
  }
  return out;
}

function encodeMessageCursor(createdAt: any, id: any) {
  const payload = {
    created_at: toIso(createdAt),
    id: String(id),
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeMessageCursor(cursor?: string | null): { created_at: string; id: string } | null {
  if (!cursor) return null;

  try {
    const decoded = Buffer.from(String(cursor), "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as { created_at?: string; id?: string };
    const created_at = String(parsed?.created_at || "").trim();
    const id = String(parsed?.id || "").trim();
    if (!created_at || !id) return null;
    return { created_at, id };
  } catch {
    return null;
  }
}

async function hydrateMessagesWithReplies(rows: any[]) {
  const replyIds = rows
    .map((r: any) => r.reply_to_id)
    .filter((x: any) => !!x);

  const replyMap: Record<string, any> = {};

  if (replyIds.length > 0) {
    const replyQuery = await query(
      `
      SELECT
        m.*,
        row_to_json(u.*) AS sender_json,
        (
          SELECT COALESCE(json_agg(row_to_json(mi.*)), '[]'::json)
          FROM message_images mi
          WHERE mi.message_id = m.id
        ) AS images_json
      FROM messages m
      LEFT JOIN users u ON u.id = m.sender_id
      WHERE m.id = ANY($1::uuid[])
      `,
      [replyIds]
    );

    replyQuery.rows.forEach((m: any) => {
      const audioFileId = m.audio_file_id ?? null;
      const audio = audioFileId
        ? {
            file_id: audioFileId,
            url: buildFileUrlById(Number(audioFileId)),
            mime: m.audio_mime ?? null,
            duration_sec:
              typeof m.audio_duration_sec === "number" ? m.audio_duration_sec : null,
          }
        : null;

      const inferredType =
        String(m.message_type || "").trim() ||
        (m.location_json
          ? "LOCATION"
          : audioFileId
          ? "AUDIO"
          : m.text
          ? "TEXT"
          : "TEXT");

      replyMap[m.id] = {
        id: m.id,
        type: inferredType,
        text: m.text,
        location: m.location_json ?? null,
        audio,
        sender: m.sender_json,
        images: Array.isArray(m.images_json)
          ? m.images_json.map((i: any) => ({
              id: i.id,
              url: i.url,
              file_id: i.file_id ?? null,
              mime: i.mime ?? null,
              width: i.width ?? null,
              height: i.height ?? null,
            }))
          : [],
      };
    });
  }

  return rows.map((r: any) => {
    const createdISO = new Date(r.created_at).toISOString();
    const mr = r.my_receipt_json || null;

    const audioFileId = r.audio_file_id ?? null;
    const audio = audioFileId
      ? {
          file_id: audioFileId,
          url: buildFileUrlById(Number(audioFileId)),
          mime: r.audio_mime ?? null,
          duration_sec:
            typeof r.audio_duration_sec === "number" ? r.audio_duration_sec : null,
        }
      : null;

    const inferredType =
      String(r.message_type || "").trim() ||
      (r.location_json ? "LOCATION" : audioFileId ? "AUDIO" : "TEXT");

    return {
      id: r.id,
      chat_id: r.chat_id,
      created_at: createdISO,
      sender: r.sender_json,

      type: inferredType,
      location: r.location_json ?? null,

      images: Array.isArray(r.images_json)
        ? r.images_json.map((img: any) => ({
            id: img.id,
            url: img.url,
            file_id: img.file_id,
            mime: img.mime || null,
            width: img.width || null,
            height: img.height || null,
          }))
        : [],

      audio,

      text: r.is_deleted ? "" : r.text,
      to_user_ids: r.to_user_ids || [],

      myReceipt: {
        deliveredAt: mr?.delivered_at
          ? new Date(mr.delivered_at).toISOString()
          : createdISO,
        readAt: mr?.read_at ? new Date(mr.read_at).toISOString() : null,
        isRead: !!mr?.is_read,
      },

      readers: Array.isArray(r.readers_json) ? r.readers_json : [],
      readersCount: Number(r.readers_count) || 0,

      is_deleted: r.is_deleted ?? false,
      deleted_at: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,

      reply_to_id: r.reply_to_id || null,
      reply_to: r.reply_to_id ? replyMap[r.reply_to_id] : null,
    };
  });
}

const rawResolvers = {
  JSON: GraphQLJSON,
  Upload: GraphQLUpload,
  Role: {
    user_count: async (parent: any) => {
      const roleId = parent?.id;
      if (!roleId) return 0;
      
      try {
        const { rows } = await query(
          `SELECT COUNT(*)::int AS count FROM users WHERE role_id = $1`,
          [roleId]
        );
        return rows[0]?.count || 0;
      } catch (err) {
        console.error('[Role.user_count] Error counting users:', err);
        return 0;
      }
    },
  },
  User: {
    roleDetails: async (parent: any) => {
      const roleId = parent?.role_id;
      if (!roleId) return null;

      try {
        const { rows } = await query(
          `SELECT id, name, description, is_active, created_at, updated_at FROM roles WHERE id = $1 LIMIT 1`,
          [roleId]
        );
        return rows[0] || null;
      } catch (err) {
        console.error('[User.roleDetails] Error fetching role:', err);
        return null;
      }
    },
    // ให้ platform admin เห็นว่า user นี้เป็นของร้านไหน (หน้า /admin/users แสดง user ข้ามร้านได้
    // แต่ไม่เคยบอกว่า user เป็นของร้านไหนเลย) — user ที่ไม่มี tenant_id (เช่นบัญชีระบบเก่า) คืน null
    tenantName: async (parent: any) => {
      if (!parent?.tenant_id) return null;
      try {
        return await getTenantName(parent.tenant_id);
      } catch (err) {
        console.error('[User.tenantName] Error fetching tenant name:', err);
        return null;
      }
    },
    // pg คืน timestamp เป็น Date object — ต้อง .toISOString() เองก่อนคืนใน field ที่เป็น String
    // (ไม่งั้น GraphQLString.serialize เรียก .valueOf() ได้ epoch number แทน — เจอบั๊กแบบนี้มาแล้วหลายที่
    // ในโปรเจกต์นี้ เช่น created_at ของ User เอง ที่หน้า list ต้อง workaround ด้วย new Date(Number(d)))
    lastLoginAt: (parent: any) => {
      const v = parent?.last_login_at;
      if (!v) return null;
      return v instanceof Date ? v.toISOString() : String(v);
    },
  },
  Message: {
    type: (parent: any) => {
      const direct = String(parent?.type ?? parent?.message_type ?? "").trim();
      if (direct) return direct;

      const hasLocation = !!(parent?.location ?? parent?.location_json);
      if (hasLocation) return "LOCATION";

      const hasAudio = !!(parent?.audio ?? parent?.audio_file_id);
      if (hasAudio) return "AUDIO";

      const text = String(parent?.text ?? "").trim();
      if (text) return "TEXT";

      return "TEXT";
    },
    location: (parent: any) => {
      return parent?.location ?? parent?.location_json ?? null;
    },
  },
  Query: {
    _health: async() =>{
      await emitPostEvent("post.created", {
        postId: "result.id",
        actorId: "author_id",
        title: "result.title",
        summary: undefined,
        url: undefined,
        revisionId: "revisionId",
        eventId: randomUUID(),
        occurredAt: new Date().toISOString()
      });

      console.error("[health] called");

      return `ok`;
    } ,
    me: async (_: any, {  }: { }, ctx: any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx, { optional: true });
      console.log("[Query] me :", author_id);

      const { rows } = await query(`SELECT * FROM users WHERE id=$1 LIMIT 1`, [author_id]);
      return rows[0];
    },
    meRole: async (_:any, __:any, ctx:any) => ctx.role || "Subscriber",
    bmsSupportTickets: async (_: any, args: any, ctx: any) => {
      await requirePlatformOnly(ctx);
      const page = Math.max(1, Number(args.page || 1));
      const pageSize = Math.min(100, Math.max(1, Number(args.pageSize || 20)));
      const where: string[] = [];
      const params: any[] = [];

      if (args.status) {
        params.push(String(args.status));
        where.push(`status = $${params.length}`);
      }
      if (args.topic) {
        params.push(String(args.topic));
        where.push(`topic = $${params.length}`);
      }
      if (args.q) {
        params.push(`%${String(args.q).trim()}%`);
        where.push(`(ticket_id ILIKE $${params.length} OR email ILIKE $${params.length} OR name ILIKE $${params.length} OR subject ILIKE $${params.length})`);
      }

      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const totalRes = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM support_tickets ${whereSql}`,
        params
      );
      params.push(pageSize, (page - 1) * pageSize);
      const rows = await query<any>(
        `SELECT id, ticket_id, name, email, phone, topic, subject, message, ref, page_url,
                user_agent, ip, status, created_at, updated_at, closed_at
           FROM support_tickets
          ${whereSql}
          ORDER BY created_at DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      const ticketIds = rows.rows.map((row: any) => row.id);
      const commentsByTicket = new Map<string, any[]>();
      if (ticketIds.length > 0) {
        const commentRows = await query<any>(
          `SELECT id, ticket_id, author_id, author_email, from_status, to_status, body, created_at
             FROM support_ticket_comments
            WHERE ticket_id = ANY($1::uuid[])
            ORDER BY created_at DESC`,
          [ticketIds]
        );
        for (const comment of commentRows.rows) {
          const key = String(comment.ticket_id);
          commentsByTicket.set(key, [...(commentsByTicket.get(key) || []), comment]);
        }
      }

      return {
        total: Number(totalRes.rows[0]?.count || 0),
        items: rows.rows.map((row: any) => mapSupportTicket(row, commentsByTicket.get(String(row.id)) || [])),
      };
    },
    // resolver: posts
    posts: async (_: any, { search }: { search?: string }, ctx: any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx, {  optionalWeb: true, optionalAndroid: true });
      console.log("[Query] posts :", author_id);

      const params: any[] = [];
      let sql = `
        SELECT
          p.*,
          row_to_json(u) AS author_json,

          -- images
          (
            SELECT COALESCE(json_agg(json_build_object('id', f.id, 'relpath', f.relpath)), '[]'::json)
            FROM post_images pi
            JOIN files f ON f.id = pi.file_id
            WHERE pi.post_id = p.id
          ) AS images,

          -- bookmarks
          COALESCE(
            JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT('user_id', bm.user_id))
            FILTER (WHERE bm.user_id IS NOT NULL),
            '[]'::JSONB
          ) AS bookmarks

        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        LEFT JOIN bookmarks bm ON bm.post_id = p.id
      `;

      if (search) {
        sql += ` WHERE p.title ILIKE $1 OR p.phone ILIKE $1 `;
        params.push(`%${search}%`);
      }

      sql += ` GROUP BY p.id, u.id ORDER BY p.created_at DESC`;

      const { rows } = await query(sql, params);

      return rows.map((r: any) => ({
        ...r,
        author: r.author_json,
        images: (r.images || []).map((it: any) => ({
          id: it.id,
          url: buildFileUrlById(it.id),
        })),
        bookmarks: r.bookmarks || [],
        isBookmarked:
          Array.isArray(r.bookmarks) && author_id
            ? r.bookmarks.some((b: any) => b.user_id === author_id)
            : false,
      }));
    },
    postsPaged: async (
      _: any,
      { search, limit, offset }: { search?: string; limit: number; offset: number },
      ctx: any
    ) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx, { optionalWeb: true, optionalAndroid: true });
      console.log("[Query] postsPaged :", author_id);

      const params: any[] = [];
      let whereSql = "";

      /* --------------------------------------
      * 🔎 SEARCH: title, phone, bank account
      * -------------------------------------- */
      if (search) {
        params.push(`%${search}%`); // $1
        const idx = params.length;

        whereSql = `
          WHERE (
            p.title ILIKE $${idx}
            OR EXISTS (
              SELECT 1 FROM post_tel_numbers t
              WHERE t.post_id = p.id
              AND t.tel ILIKE $${idx}
            )
            OR EXISTS (
              SELECT 1 FROM post_seller_accounts s
              WHERE s.post_id = p.id
              AND (
                s.seller_account ILIKE $${idx}
                OR s.bank_name ILIKE $${idx}
                OR s.bank_id ILIKE $${idx}
              )
            )
          )
        `;
      }

      /* --------------------------------------
      * 💡 ALWAYS enforce public status
      * -------------------------------------- */
      if (whereSql.trim() === "") {
        whereSql = `WHERE p.status = 'public'`;
      } else {
        whereSql += ` AND p.status = 'public'`;
      }

      /* --------------------------------------
      * ⭐ is_bookmarked (current user)
      * -------------------------------------- */
      let isBookmarkedSelect = `false AS is_bookmarked`;
      if (author_id) {
        params.push(author_id);
        const meIdx = params.length;

        isBookmarkedSelect = `
          EXISTS (
            SELECT 1 FROM bookmarks bm
            WHERE bm.post_id = p.id
              AND bm.user_id = $${meIdx}
          ) AS is_bookmarked
        `;
      }

      /* --------------------------------------
      * LIMIT / OFFSET
      * -------------------------------------- */
      params.push(limit, offset);
      const limitIdx = params.length - 1;
      const offsetIdx = params.length;

      const sql = `
        SELECT
          COUNT(*) OVER() AS total,
          p.*,
          row_to_json(u) AS author_json,

          -- ✅ facebook permalink (จาก social_posts)
          sp_fb.permalink_url AS fb_permalink_url,
          sp_fb.published_at  AS fb_published_at,
          sp_fb.status        AS fb_status,
          sp_fb.social_post_id AS fb_social_post_id,

          -- images
          (
            SELECT json_agg(json_build_object('id', f.id, 'relpath', f.relpath) ORDER BY pi.id)
            FROM post_images pi
            JOIN files f ON f.id = pi.file_id
            WHERE pi.post_id = p.id
          ) AS images_json,

          -- tel numbers
          (
            SELECT json_agg(json_build_object('id', t.id, 'tel', t.tel) ORDER BY t.created_at)
            FROM post_tel_numbers t
            WHERE t.post_id = p.id
          ) AS tel_numbers_json,

          -- seller accounts
          (
            SELECT json_agg(
              json_build_object(
                'id', s.id,
                'bank_id', s.bank_id,
                'bank_name', s.bank_name,
                'seller_account', s.seller_account
              )
              ORDER BY s.created_at
            )
            FROM post_seller_accounts s
            WHERE s.post_id = p.id
          ) AS seller_accounts_json,

          -- 🔢 comments count
          (
            SELECT COUNT(*)
            FROM comments c
            WHERE c.post_id = p.id
          ) AS comments_count,

          -- is_bookmarked
          ${isBookmarkedSelect}

        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id

        -- ✅ JOIN social_posts เฉพาะ facebook (แถวเดียว)
        LEFT JOIN social_posts sp_fb
          ON sp_fb.post_id = p.id
        AND sp_fb.platform = 'facebook'

        ${whereSql}
        ORDER BY p.created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;

      const { rows } = await query(sql, params);
      const total = rows[0]?.total ? Number(rows[0].total) : 0;

      const items = rows.map((r: any) => ({
        ...r,
        author: r.author_json,

        images: (r.images_json || []).map((it: any) => ({
          id: it.id,
          url: buildFileUrlById(it.id),
        })),

        tel_numbers: (r.tel_numbers_json || []).map((t: any) => ({
          id: t.id,
          tel: t.tel,
        })),

        seller_accounts: (r.seller_accounts_json || []).map((s: any) => ({
          id: s.id,
          bank_id: s.bank_id,
          bank_name: s.bank_name,
          seller_account: s.seller_account,
        })),

        comments_count: Number(r.comments_count || 0),
        is_bookmarked: !!r.is_bookmarked,

        // ✅ เพิ่ม fields สำหรับหน้า list
        fb_permalink_url: r.fb_permalink_url ?? null,
        fb_published_at: r.fb_published_at ?? null,
        fb_status: r.fb_status ?? null,
        fb_social_post_id: r.fb_social_post_id ?? null,
      }));

      return { items, total };
    },
    post: async (_: any, { id }: { id: string }, ctx: any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx, {  optionalWeb: true, optionalAndroid: true });
      console.log("[Query] post :", author_id);

      // ✅ 1) ดึง post + author + province + is_bookmarked + social_posts (facebook)
      const { rows } = await query(
        `
        SELECT
          p.*,
          row_to_json(u) AS author_json,
          pr.name_th AS province_name,

          -- ✅ social (facebook)
          sp_fb.permalink_url AS fb_permalink_url,
          sp_fb.published_at  AS fb_published_at,
          sp_fb.status        AS fb_status,
          sp_fb.social_post_id AS fb_social_post_id,

          -- ✅ คำนวณ is_bookmarked แบบไม่เป็น null
          CASE
            WHEN $2::uuid IS NULL THEN false
            ELSE EXISTS (
              SELECT 1 FROM bookmarks b
              WHERE b.post_id = p.id AND b.user_id = $2::uuid
            )
          END AS is_bookmarked

        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        LEFT JOIN provinces pr ON pr.id = p.province_id

        -- ✅ JOIN social_posts เฉพาะ facebook (แถวเดียว)
        LEFT JOIN social_posts sp_fb
          ON sp_fb.post_id = p.id
        AND sp_fb.platform = 'facebook'

        WHERE p.id = $1
        `,
        [id, author_id ?? null]
      );

      const r = rows[0];
      if (!r) return null;

      // ✅ 2) images
      const { rows: imgs } = await query(
        `
        SELECT f.id, f.relpath
        FROM post_images pi
        JOIN files f ON f.id = pi.file_id
        WHERE pi.post_id = $1
        ORDER BY pi.id
        `,
        [id]
      );

      // ✅ 3) tel_numbers
      const { rows: telNumbers } = await query(
        `
        SELECT id, tel, created_at
        FROM post_tel_numbers
        WHERE post_id = $1
        ORDER BY created_at ASC
        `,
        [id]
      );

      // ✅ 4) seller_accounts
      const { rows: sellerAccounts } = await query(
        `
        SELECT id, bank_id, bank_name, seller_account, created_at
        FROM post_seller_accounts
        WHERE post_id = $1
        ORDER BY created_at ASC
        `,
        [id]
      );

      return {
        ...r,

        // ✅ เพิ่มฟิลด์ auto_publish (กัน null -> boolean เสมอ)
        auto_publish: !!r.auto_publish,

        author: r.author_json,
        province_name: r.province_name || null,
        is_bookmarked: !!r.is_bookmarked,

        images: (imgs || []).map((it: any) => ({
          id: it.id,
          url: buildFileUrlById(it.id),
        })),

        tel_numbers: telNumbers || [],
        seller_accounts: sellerAccounts || [],

        // ✅ social (facebook) ที่เว็บจะใช้ทำปุ่ม "ไปที่โพสต์"
        fb_permalink_url: r.fb_permalink_url ?? null,
        fb_published_at: r.fb_published_at ?? null,
        fb_status: r.fb_status ?? null,
        fb_social_post_id: r.fb_social_post_id ?? null,
      };
    },
    myPosts: async (_:any, { search }:{search?:string}, ctx:any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      console.log("[Query] myPosts :", author_id);

      if (search) {
        const { rows } = await query(
          `SELECT p.*, row_to_json(u.*) as author_json
           FROM posts p LEFT JOIN users u ON p.author_id = u.id
           WHERE p.author_id=$1 AND (p.title ILIKE $2 OR p.phone ILIKE $2)
           ORDER BY p.created_at DESC`, [author_id, '%' + search + '%']
        );
        return rows.map((r :any)=>({ ...r, author: r.author_json }));
      }
      const { rows } = await query(
        `SELECT p.*, row_to_json(u.*) as author_json
         FROM posts p LEFT JOIN users u ON p.author_id = u.id
         WHERE p.author_id=$1
         ORDER BY p.created_at DESC`, [author_id]
      );
      return rows.map((r :any)=>({ ...r, author: r.author_json }));
    },
    getOrCreateDm: async (_:any, { user_id }:{user_id:string}, ctx: any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      console.log("[Query] getOrCreateDm :", ctx, author_id);

      if (!author_id) throw new Error("No demo user found");
      const { rows:exist } = await query(
        `SELECT c.* FROM chats c
         JOIN chat_members m1 ON m1.chat_id=c.id AND m1.user_id=$1
         JOIN chat_members m2 ON m2.chat_id=c.id AND m2.user_id=$2
         WHERE c.is_group=false LIMIT 1`, [author_id, user_id]
      );
      if (exist[0]) return exist[0];
      const { rows:crows } = await query(
        `INSERT INTO chats(is_group, created_by) VALUES(false, $1) RETURNING *`, [author_id]
      );
      const chat = crows[0];

      console.log("[getOrCreateDm]" , chat.id, author_id, user_id);
      // await query(`INSERT INTO chat_members(chat_id, user_id) VALUES ($1,$2),($1,$3)`, [chat.id, meId, user_id]);
      return chat;
    },
    myChats: async (_: any, { }: {}, ctx: any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);

      const { rows } = await query(
        `
        SELECT
          c.*,
          row_to_json(uc.*) AS creator_json,

          -- last message + images
          (
            SELECT json_build_object(
              'id', lm.id,
              'chat_id', lm.chat_id,
              'text', lm.text,
              'created_at', lm.created_at,
              'sender_id', lm.sender_id,
              'audio_file_id', lm.audio_file_id,
              'audio_mime', lm.audio_mime,
              'audio_duration_sec', lm.audio_duration_sec,
              'images',
              (
                SELECT COALESCE(json_agg(row_to_json(mi.*)), '[]'::json)
                FROM message_images mi
                WHERE mi.message_id = lm.id
              )
            )
            FROM messages lm
            WHERE lm.chat_id = c.id
            ORDER BY lm.created_at DESC
            LIMIT 1
          ) AS last_message_json

        FROM chats c
        LEFT JOIN users uc ON c.created_by = uc.id
        WHERE EXISTS (
          SELECT 1
          FROM chat_members m
          WHERE m.chat_id = c.id AND m.user_id = $1
        )
        ORDER BY c.created_at DESC
        `,
        [author_id]
      );

      const out: any[] = [];

      for (const c of rows) {
        const mem = await query(
          `
          SELECT 
            u.id, u.name, u.avatar, u.phone, u.email,
            u.role, u.created_at, u.username, u.language
          FROM chat_members m
          JOIN users u ON m.user_id = u.id
          WHERE m.chat_id = $1
          `,
          [c.id]
        );

        let lastMessage = null;
        let lastMessageAt: string | null = null;

        if (c.last_message_json) {
          const lm = c.last_message_json;

          lastMessageAt = lm.created_at;//new Date(lm.created_at).toISOString();

          // แปลง images ให้เป็น array เสมอ
          const rawImages = Array.isArray(lm.images) ? lm.images : [];

          lastMessage = {
            id: lm.id,
            chat_id: lm.chat_id,
            text: lm.text || "",
            created_at: lastMessageAt,
            sender_id: lm.sender_id,

            audio: lm.audio_file_id
              ? {
                  file_id: lm.audio_file_id,
                  url: buildFileUrlById(Number(lm.audio_file_id)),
                  mime: lm.audio_mime ?? null,
                  duration_sec:
                    typeof lm.audio_duration_sec === "number"
                      ? lm.audio_duration_sec
                      : null,
                }
              : null,

            images: rawImages.map((img: any) => ({
              id: img.id,
              url: img.url,
              file_id: img.file_id ?? null,
              mime: img.mime ?? null,
              width: img.width ?? null,
              height: img.height ?? null,
            })),

            // ฟิลด์อื่น ๆ เดี๋ยวให้ resolver ของ Message จัดการต่อ
            to_user_ids: [],
            is_deleted: false,
            deleted_at: null,
            myReceipt: null,
            readers: [],
            readersCount: 0,
          };
        }

        out.push({
          id: c.id,
          name: c.name,
          is_group: c.is_group,
          is_undeletable: c.is_undeletable ?? false,
          created_at: new Date(c.created_at).toISOString(),
          created_by: c.creator_json,
          members: mem.rows,
          last_message: lastMessage,
          last_message_at: lastMessageAt,
        });
      }
      // console.log("[Query] myChats :", out);
      return out;
    },
    myChatSettings: async (_: any, { chat_id }: { chat_id: string }, ctx: any) => {
      const { author_id } = requireAuth(ctx);

      const { rows } = await query(
        `
        SELECT
          COALESCE(is_muted, false) AS is_muted,
          COALESCE(notifications_enabled, true) AS notifications_enabled
        FROM chat_members
        WHERE chat_id = $1 AND user_id = $2
        LIMIT 1
        `,
        [chat_id, author_id]
      );

      if (!rows[0]) {
        throw new Error("Chat membership not found");
      }

      return {
        is_muted: !!rows[0].is_muted,
        notifications_enabled: !!rows[0].notifications_enabled,
      };
    },
    myBookmarks: async (_: any, { limit = 20, offset = 0 }: any, ctx: any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      console.log("[Query] myBookmarks :",  author_id);

      const { rows } = await query(
        `
        SELECT p.*, row_to_json(u) AS author_json,
               (
                 SELECT json_agg(json_build_object('id', f.id, 'relpath', f.relpath))
                 FROM post_images pi
                 JOIN files f ON f.id = pi.file_id
                 WHERE pi.post_id = p.id
               ) AS images_json
        FROM bookmarks b
        JOIN posts p ON b.post_id = p.id
        LEFT JOIN users u ON p.author_id = u.id
        WHERE b.user_id = $1
        ORDER BY b.created_at DESC
        LIMIT $2 OFFSET $3
        `,
        [author_id, limit, offset]
      );

      return rows.map((r: any) => ({
        ...r,
        author: r.author_json,
        images: (r.images_json || []).map((it: any) => ({
          id: it.id,
          url: buildFileUrlById(it.id),
        })),
        is_bookmarked: true
      }));
    },
    messages: async (
      _: any,
      {
        chat_id,
        limit = 50,
        offset = 0,
        includeDeleted = false,
      }: {
        chat_id: string;
        limit?: number;
        offset?: number;
        includeDeleted?: boolean;
      },
      ctx: any
    ) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);

      const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
      const safeOffset = Math.max(Number(offset) || 0, 0);

      console.log("[Query] messages :", author_id, safeLimit, safeOffset);

      const filter = includeDeleted ? "" : "AND m.deleted_at IS NULL";

      const { rows } = await query(
        `
        SELECT
          m.*,
          (m.deleted_at IS NOT NULL) AS is_deleted,
          row_to_json(u.*) AS sender_json,

          (
            SELECT COALESCE(json_agg(row_to_json(mi.*)), '[]'::json)
            FROM message_images mi
            WHERE mi.message_id = m.id
          ) AS images_json,

          (
            SELECT json_build_object(
              'delivered_at', r.delivered_at,
              'read_at',      r.read_at,
              'is_read',      (r.read_at IS NOT NULL)
            )
            FROM message_receipts r
            WHERE r.message_id = m.id AND r.user_id = $2
            LIMIT 1
          ) AS my_receipt_json,

          (
            SELECT COALESCE(json_agg(row_to_json(ru.*) ORDER BY r2.read_at ASC), '[]'::json)
            FROM message_receipts r2
            JOIN users ru ON ru.id = r2.user_id
            WHERE r2.message_id = m.id AND r2.read_at IS NOT NULL
          ) AS readers_json,

          (
            SELECT COUNT(*)::INT
            FROM message_receipts r3
            WHERE r3.message_id = m.id AND r3.read_at IS NOT NULL
          ) AS readers_count

        FROM messages m
        LEFT JOIN users u ON u.id = m.sender_id
        WHERE m.chat_id = $1 ${filter}
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $3 OFFSET $4
        `,
        [chat_id, author_id, safeLimit, safeOffset]
      );

      const results = await hydrateMessagesWithReplies(rows);

      console.log("[Query] messages", chat_id, results.length);
      return results;
    },
    messagesConnection: async (
      _: any,
      {
        chat_id,
        limit = 30,
        cursor,
        includeDeleted = false,
      }: {
        chat_id: string;
        limit?: number;
        cursor?: string | null;
        includeDeleted?: boolean;
      },
      ctx: any
    ) => {
      const { author_id } = requireAuth(ctx);
      const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);

      const decoded = decodeMessageCursor(cursor);
      if (cursor && !decoded) {
        throw new GraphQLError("Invalid cursor", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }

      const filter = includeDeleted ? "" : "AND m.deleted_at IS NULL";
      const cursorSql = decoded
        ? `AND (m.created_at, m.id) < ($4::timestamptz, $5::uuid)`
        : "";

      const params = decoded
        ? [chat_id, author_id, safeLimit + 1, decoded.created_at, decoded.id]
        : [chat_id, author_id, safeLimit + 1];

      const { rows } = await query(
        `
        SELECT
          m.*,
          (m.deleted_at IS NOT NULL) AS is_deleted,
          row_to_json(u.*) AS sender_json,

          (
            SELECT COALESCE(json_agg(row_to_json(mi.*)), '[]'::json)
            FROM message_images mi
            WHERE mi.message_id = m.id
          ) AS images_json,

          (
            SELECT json_build_object(
              'delivered_at', r.delivered_at,
              'read_at',      r.read_at,
              'is_read',      (r.read_at IS NOT NULL)
            )
            FROM message_receipts r
            WHERE r.message_id = m.id AND r.user_id = $2
            LIMIT 1
          ) AS my_receipt_json,

          (
            SELECT COALESCE(json_agg(row_to_json(ru.*) ORDER BY r2.read_at ASC), '[]'::json)
            FROM message_receipts r2
            JOIN users ru ON ru.id = r2.user_id
            WHERE r2.message_id = m.id AND r2.read_at IS NOT NULL
          ) AS readers_json,

          (
            SELECT COUNT(*)::INT
            FROM message_receipts r3
            WHERE r3.message_id = m.id AND r3.read_at IS NOT NULL
          ) AS readers_count

        FROM messages m
        LEFT JOIN users u ON u.id = m.sender_id
        WHERE m.chat_id = $1 ${filter}
        ${cursorSql}
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $3
        `,
        params
      );

      const hasMore = rows.length > safeLimit;
      const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;
      const items = await hydrateMessagesWithReplies(pageRows);
      const last = pageRows[pageRows.length - 1];

      return {
        items,
        hasMore,
        nextCursor: hasMore && last ? encodeMessageCursor(last.created_at, last.id) : null,
      };
    },
    roles: async (_: any, __: any, ctx: any) => {
      const { author_id } = requireAuth(ctx, { optionalWeb: true, optionalAndroid: true });
      console.log('[Query] roles:', author_id);

      try {
        const { rows } = await query(
          `SELECT id, name, description, is_active, created_at, updated_at 
           FROM roles 
           ORDER BY name ASC`
        );
        return rows;
      } catch (err) {
        console.error('[Query.roles] Error fetching roles:', err);
        return [];
      }
    },
    role: async (_: any, { id }: { id: string }, ctx: any) => {
      const { author_id } = requireAuth(ctx, { optionalWeb: true, optionalAndroid: true });
      console.log('[Query] role:', author_id, id);

      try {
        const { rows } = await query(
          `SELECT id, name, description, is_active, created_at, updated_at 
           FROM roles 
           WHERE id = $1 
           LIMIT 1`,
          [id]
        );
        return rows[0] || null;
      } catch (err) {
        console.error('[Query.role] Error fetching role:', err);
        return null;
      }
    },
    users: async (
      _: any,
      { search, limit = 10, offset = 0 }: { search?: string; limit?: number; offset?: number },
      ctx: any
    ) => {
      const auth = requireAuth(ctx);
      console.log("[Query] users :", auth.author_id, { search, limit, offset });

      // กัน limit โหด ๆ
      const safeLimit = Math.min(Math.max(limit || 10, 1), 100);
      const safeOffset = Math.max(offset || 0, 0);

      const conds: string[] = [];
      const params: any[] = [];

      if (search) {
        params.push(`%${search}%`);
        const p = `$${params.length}`;
        conds.push(`(name ILIKE ${p} OR phone ILIKE ${p} OR email ILIKE ${p})`);
      }

      // scope=admin → หน้าจัดการผู้ใช้ BMS: บังคับสิทธิ์ + กรองตามร้าน
      //   (scope=web/android = ค้นหาคนในแอป social → คงเดิม ไม่กรอง)
      if (auth.scope === "admin") {
        const { platform, tenantId } = await requireUserAdmin(ctx);
        if (!platform) {
          params.push(tenantId);
          conds.push(`tenant_id = $${params.length}`);
        }
      }

      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : ``;

      // total
      const totalRes = await query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM users ${where}`,
        params
      );
      const total = Number(totalRes.rows[0]?.total || 0);

      // items
      const limitPos = params.length + 1;
      const offsetPos = params.length + 2;

      const itemsRes = await query(
        `
        SELECT *
        FROM users
        ${where}
        ORDER BY created_at DESC
        LIMIT $${limitPos} OFFSET $${offsetPos}
        `,
        [...params, safeLimit, safeOffset]
      );

      return { items: itemsRes.rows, total };
    },
    user: async (_: any, { id }: { id: string }, ctx: any) => {
      const { author_id, scope } = requireAuth(ctx, {  optionalWeb: true, optionalAndroid: true });
      console.log("[Query] user", id, author_id);

      if (scope === "admin") {
        const { platform, tenantId } = await requireUserAdmin(ctx);
        if (!platform) {
          const { rows } = await query(
            `SELECT id FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
            [id, tenantId]
          );
          if (!rows[0]) return null;
        }
      }

      return await getUserById(id);
    },
    postsByUserId: async (_: any, { user_id }: { user_id: string }, ctx: any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx, {  optionalWeb: true, optionalAndroid: true });
      console.log("[Query] postsByUserId :", author_id, "target:", user_id);

      const params: any[] = [user_id];
      const sql = `
        SELECT
          p.*,
          row_to_json(u) AS author_json,

          -- tel_numbers
          (
            SELECT COALESCE(
              json_agg(
                json_build_object(
                  'id', t.id,
                  'tel', t.tel
                )
              ),
              '[]'::json
            )
            FROM post_tel_numbers t
            WHERE t.post_id = p.id
          ) AS tel_numbers,

          -- seller_accounts
          (
            SELECT COALESCE(
              json_agg(
                json_build_object(
                  'id', sa.id,
                  'bank_id', sa.bank_id,
                  'bank_name', sa.bank_name,
                  'seller_account', sa.seller_account
                )
              ),
              '[]'::json
            )
            FROM post_seller_accounts sa
            WHERE sa.post_id = p.id
          ) AS seller_accounts,

          -- images
          (
            SELECT COALESCE(
              json_agg(
                json_build_object('id', f.id, 'relpath', f.relpath)
              ),
              '[]'::json
            )
            FROM post_images pi
            JOIN files f ON f.id = pi.file_id
            WHERE pi.post_id = p.id
          ) AS images,

          -- bookmarks
          COALESCE(
            JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT('user_id', bm.user_id))
            FILTER (WHERE bm.user_id IS NOT NULL),
            '[]'::JSONB
          ) AS bookmarks

        FROM posts p
        LEFT JOIN users u ON p.author_id = u.id
        LEFT JOIN bookmarks bm ON bm.post_id = p.id
        WHERE p.author_id = $1
        GROUP BY p.id, u.id
        ORDER BY p.created_at DESC
      `;

      const { rows } = await query(sql, params);

      return rows.map((r: any) => ({
        ...r,
        author: r.author_json,
        images: (r.images || []).map((it: any) => ({
          id: it.id,
          url: buildFileUrlById(it.id),
        })),

        // ✅ ไม่ให้เป็น null
        tel_numbers: (r.tel_numbers || []).map((it: any) => ({
          id: it.id,
          tel: it.tel,
        })),

        seller_accounts: (r.seller_accounts || []).map((it: any) => ({
          id: it.id,
          bank_id: it.bank_id,
          bank_name: it.bank_name,
          seller_account: it.seller_account,
        })),

        bookmarks: r.bookmarks || [],
        isBookmarked:
          Array.isArray(r.bookmarks) && author_id
            ? r.bookmarks.some((b: any) => b.user_id === author_id)
            : false,
      }));
    },
    unreadCount: async (_:any, { chatId }:{ chatId: string }, ctx:any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      console.log("[Query] unreadCount :", author_id);

      const { rows } = await query(
        `SELECT unread_count FROM chat_unread_counts WHERE user_id=$1 AND chat_id=$2`,
        [author_id, chatId]
      ).catch(()=>({ rows:[] as any[] }));
      if (rows[0]) return Number(rows[0].unread_count || 0);

      const { rows:rows2 } = await query(
        `SELECT COUNT(*)::BIGINT AS unread_count
         FROM messages m
         LEFT JOIN message_receipts r ON r.message_id=m.id AND r.user_id=$1
         WHERE m.chat_id=$2 
          AND m.sender_id <> $1 
          AND (r.read_at IS NULL)
          AND m.deleted_at IS NULL`,
        [author_id, chatId]
      );
      return Number(rows2[0]?.unread_count || 0);
    },
    myUnreadChatCount: async (_: any, __: any, ctx: any) => {
      const { author_id } = requireAuth(ctx);
      const { rows } = await query(
        `
        SELECT COALESCE(SUM(unread_count), 0)::BIGINT AS c
        FROM chat_unread_counts
        WHERE user_id = $1
        `,
        [author_id]
      );
      return Number(rows[0]?.c || 0);
    },
    whoRead: async (_:any, { messageId }:{messageId:string}, ctx:any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      console.log("[Query] whoRead :", author_id);

      const { rows } = await query(
        `SELECT u.* FROM message_receipts r
         JOIN users u ON u.id = r.user_id
         WHERE r.message_id=$1 AND r.read_at IS NOT NULL
         ORDER BY r.read_at ASC`,
        [messageId]
      );
      return rows;
    },
    stats: async (_:any, __:any, ctx:any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      console.log("[Query] stats :", author_id);

      const results = await Promise.all([
        query(`SELECT COUNT(*)::int AS c FROM users`),
        query(`SELECT COUNT(*)::int AS c FROM posts`),
        query(`SELECT COUNT(*)::int AS c FROM files WHERE deleted_at IS NULL`),
        query(`SELECT COUNT(*)::int AS c FROM system_logs`),
      ]);

      const [users, posts, files, logs] = results.map(( r:any)=> r.rows[0].c);

      return { users, posts, files, logs };
    },
    latestUsers: async (_: any, { limit = 5 }: any, ctx: any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      console.log("[Query] latestUsers :", author_id);

      const { rows } = await query(
        `SELECT id, name, email, role, created_at, avatar
        FROM users
        ORDER BY created_at DESC
        LIMIT $1`,
        [limit]
      );

      return rows.map((u: any) => ({
        ...u,
        avatar: u.avatar || null, // ถ้าไม่มีค่าให้เป็น null
      }));
    },
    latestPosts: async (_: any, { limit = 5 }: any, ctx: any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      console.log("[Query] latestPosts :", author_id);

      const { rows } = await query(
        `
        SELECT 
          p.id, p.title, p.status, p.created_at,
          (
            SELECT json_agg(json_build_object('id', f.id, 'relpath', f.relpath) ORDER BY pi.id)
            FROM post_images pi
            JOIN files f ON f.id = pi.file_id
            WHERE pi.post_id = p.id
          ) AS images_json
        FROM posts p
        ORDER BY p.created_at DESC
        LIMIT $1
        `,
        [limit]
      );

      return rows.map((r: any) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        created_at: r.created_at,
        images: (r.images_json || []).map((it: any) => ({
          id: it.id,
          url: buildFileUrlById(it.id),
        })),
      }));
    },
    pending: async (_:any, __:any, ctx:any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      console.log("[Query] pending :", author_id);

      const [posts, users, files, logs] = await Promise.all([
        query(`SELECT COUNT(*)::int AS c FROM posts WHERE status = 'pending'`),
        query(`SELECT COUNT(*)::int AS c FROM users WHERE status = 'invited' OR email_verified = false`),
        query(`SELECT COUNT(*)::int AS c FROM files WHERE category IS NULL AND deleted_at IS NULL`),
        query(`SELECT COUNT(*)::int AS c FROM system_logs WHERE level = 'error' AND created_at >= NOW() - INTERVAL '24 hours'`)
      ]);

      return {
        posts_awaiting_approval: posts.rows[0]?.c || 0,
        users_pending_invite: users.rows[0]?.c || 0,
        files_unclassified: files.rows[0]?.c || 0,
        errors_last24h: logs.rows[0]?.c || 0,
      };
    },
    filesPaged: async (_: any, { search, limit, offset }: any, ctx: any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      console.log("[Query] pending :", author_id);

      const params: any[] = [];
      let where = '';
      if (search && search.trim()) {
        params.push(`%${search}%`);
        where = `WHERE f.original_name ILIKE $${params.length} OR f.filename ILIKE $${params.length}`;
      }
      params.push(limit, offset);

      const sql = `
        SELECT
          COUNT(*) OVER() AS total,
          f.*
        FROM files f
        ${where}
        ORDER BY f.created_at DESC
        LIMIT $${params.length-1} OFFSET $${params.length}
      `;
      const { rows } = await query(sql, params);
      const total = rows[0]?.total ? Number(rows[0].total) : 0;

      const items = rows.map((r: any) => ({
        ...r,
        url: buildFileUrlById(r.id),
        thumb: r.mimetype && r.mimetype.startsWith('image/')
          ? buildFileUrlById(r.id)
          : null,
      }));

      return { items, total };
    },

    // 
    myNotifications: async (
      _: any,
      args: { limit?: number; offset?: number },
      ctx: any
    ) => {
      const user = ctx.user; // สมมติ auth middleware ใส่มาแล้ว
      if (!user) throw new Error('Unauthorized');

      const limit = args.limit ?? 20;
      const offset = args.offset ?? 0;

      const { rows } = await query(
        `
        SELECT
          id,
          user_id,
          type,
          title,
          message,
          entity_type,
          entity_id,
          data,
          is_read,
          created_at
        FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        OFFSET $3
        `,
        [user.id, limit, offset]
      );

      return rows;
    },
    myUnreadNotificationCount: async (_: any, __: any, ctx: any) => {
      const user = ctx.user;
      if (!user) throw new Error('Unauthorized');

      const { rows } = await query(
        `
        SELECT COUNT(*)::int AS count
        FROM notifications
        WHERE user_id = $1
          AND is_read = FALSE
        `,
        [user.id]
      );

      return rows[0]?.count ?? 0;
    },
    comments: async (_: any, { post_id }: { post_id: string }) => {
      const { rows } = await query(
        `
        SELECT
          c.id,
          c.post_id,
          c.user_id,
          c.parent_id,
          c.content,
          c.created_at,
          c.updated_at,
          u.id   AS u_id,
          u.name AS u_name,
          u.avatar AS u_avatar
        FROM comments c
        JOIN users u ON c.user_id = u.id
        WHERE c.post_id = $1
        ORDER BY c.created_at ASC
        `,
        [post_id]
      );

      // สร้าง comment object พร้อม user + replies array
      const byId = new Map<string, any>();

      for (const r of rows) {
        const comment = {
          id: r.id,
          post_id: r.post_id,
          user_id: r.user_id,
          parent_id: r.parent_id,
          content: r.content,
          created_at: r.created_at ? new Date(r.created_at).toISOString() : null, // r.created_at,
          updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : null, // r.updated_at,
          user: {
            id: r.u_id,
            name: r.u_name,
            avatar: r.u_avatar,
          },
          replies: [] as any[],
        };

        byId.set(comment.id, comment);
      }

      // ประกอบ tree: ใครมี parent_id ก็ใส่เข้า replies ของ parent
      const roots: any[] = [];

      for (const comment of byId.values()) {
        if (comment.parent_id && byId.has(comment.parent_id)) {
          const parent = byId.get(comment.parent_id);
          parent.replies.push(comment);
        } else {
          roots.push(comment);
        }
      }

      return roots;
    },
    globalSearch: async (_: any, { q }: { q: string }, ctx: any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx, {  optionalWeb: true, optionalAndroid: true });
      console.log("[Query] globalSearch (pro) :", author_id, q);

      const term = (q || "").trim();
      if (!term) {
        return { posts: [], users: [], phones: [], bank_accounts: [] };
      }

      const like = buildLike(term);
      const useTrgm = term.length >= 3;

      // ============================
      // 1) POSTS (posts + title/detail_unaccent)
      // ============================
      const postsPromise = query(
        `
        SELECT
          s.id,
          s.title,
          s.snippet,
          s.created_at
        FROM (
          SELECT
            p.id,
            p.title,
            p.detail AS snippet,
            p.created_at,

            -- full-text rank (title A, detail C)
            ts_rank(
              tsvector_concat(
                setweight(to_tsvector('simple', coalesce(p.title_unaccent,  '')), 'A'),
                setweight(to_tsvector('simple', coalesce(p.detail_unaccent, '')), 'C')
              ),
              plainto_tsquery('simple', unaccent($1))
            ) AS ft_rank,

            -- trigram similarity
            GREATEST(
              similarity(coalesce(p.title_unaccent,  ''), unaccent($1)),
              similarity(coalesce(p.detail_unaccent, ''), unaccent($1))
            ) AS sim
          FROM posts p
          WHERE
                tsvector_concat(
                  setweight(to_tsvector('simple', coalesce(p.title_unaccent,  '')), 'A'),
                  setweight(to_tsvector('simple', coalesce(p.detail_unaccent, '')), 'C')
                ) @@ plainto_tsquery('simple', unaccent($1))
             OR p.title_unaccent  ILIKE unaccent($2)
             OR p.detail_unaccent ILIKE unaccent($2)
             -- เผื่อ row เก่าที่ยังไม่ได้ backfill
             OR p.title  ILIKE $2
             OR p.detail ILIKE $2
        ) AS s
        ORDER BY
          (s.ft_rank * 2.0 + s.sim * 5.0) DESC,
          s.created_at DESC
        LIMIT 20
        `,
        [term, like]
      );

      // ============================
      // 2) USERS (users + name/email_unaccent)
      // ============================
      const usersPromise = query(
        `
        SELECT
          s.id,
          s.name,
          s.email,
          s.phone,
          s.avatar
        FROM (
          SELECT
            u.id,
            u.name,
            u.email,
            u.phone,
            u.avatar,

            ts_rank(
              tsvector_concat(
                setweight(to_tsvector('simple', coalesce(u.name_unaccent,  '')), 'A'),
                setweight(to_tsvector('simple', coalesce(u.email_unaccent, '')), 'B')
              ),
              plainto_tsquery('simple', unaccent($1))
            ) AS ft_rank,

            GREATEST(
              similarity(coalesce(u.email_unaccent, ''), unaccent($1)),
              similarity(coalesce(u.phone,          ''), $1)
            ) AS sim
          FROM users u
          WHERE
                tsvector_concat(
                  setweight(to_tsvector('simple', coalesce(u.name_unaccent,  '')), 'A'),
                  setweight(to_tsvector('simple', coalesce(u.email_unaccent, '')), 'B')
                ) @@ plainto_tsquery('simple', unaccent($1))
             OR u.name_unaccent  ILIKE unaccent($2)
             OR u.email_unaccent ILIKE unaccent($2)
             OR u.phone ILIKE $2
        ) AS s
        ORDER BY
          (s.ft_rank * 2.5 + s.sim * 4.0) DESC
        LIMIT 20
        `,
        [term, like]
      );

      // ============================
      // 3) PHONES = post_tel_numbers
      // ============================

      const phonesSql = `
        SELECT
          array_agg(DISTINCT post_id::text) AS ids,
          tel                               AS phone,
          COUNT(*)                          AS report_count,
          MAX(created_at)                   AS last_report_at
        FROM post_tel_numbers
        WHERE
          ${useTrgm ? "tel % $1" : "tel ILIKE $1"}
        GROUP BY tel
        ORDER BY
          report_count   DESC,
          last_report_at DESC
        LIMIT 20
      `;

      const phonesParams = [useTrgm ? term : like];

      const phonesPromise = query(phonesSql, phonesParams);

      // ============================
      // 4) BANK ACCOUNTS = post_seller_accounts
      // ============================

      const banksSql = `
        SELECT
          array_agg(DISTINCT post_id::text) AS ids,
          bank_name,
          seller_account,
          COUNT(*)            AS report_count,
          MAX(created_at)     AS last_report_at
        FROM post_seller_accounts
        WHERE
          ${
            useTrgm
              ? "(account_unaccent % $1 OR bank_unaccent % $1)"
              : "(account_unaccent ILIKE $1 OR bank_unaccent ILIKE $1)"
          }
        GROUP BY bank_name, seller_account
        ORDER BY
          report_count   DESC,
          last_report_at DESC
        LIMIT 20
      `;

      const banksParams = [useTrgm ? term : like];

      const banksPromise = query(banksSql, banksParams);


      // run พร้อมกัน
      const [postsRes, usersRes, phonesRes, banksRes] = await Promise.all([
        postsPromise,
        usersPromise,
        phonesPromise,
        banksPromise,
      ]);

      const posts = postsRes.rows.map((row: any) => ({
        id: row.id,
        entity_id: row.id,
        title: row.title,
        snippet: row.snippet,
        created_at: row.created_at,
      }));

      const users = usersRes.rows.map((row: any) => ({
        id: row.id,
        entity_id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        avatar: row.avatar,
      }));

      const phones = phonesRes.rows.map((row: any) => ({
        // id: row.id,
        // entity_id: row.id,

        id: row.ids?.[0] ?? row.phone,
        entity_id: row.ids?.[0] ?? row.phone,

        // รวม post_id ทั้งหมดที่มีเบอร์นี้
        ids: row.ids ?? [],
        phone: row.phone,
        report_count: row.report_count,
        last_report_at: row.last_report_at,
      }));

      const bank_accounts = banksRes.rows.map((row: any) => ({
        // id: row.id,
        // entity_id: row.id,
        id: row.ids?.[0] ?? row.bank_name,
        entity_id: row.ids?.[0] ?? row.bank_name,
        ids: row.ids ?? [],     
        bank_name: row.bank_name,
        account_no_masked: row.seller_account,
        report_count: row.report_count,
        last_report_at: row.last_report_at,
      }));

      return { posts, users, phones, bank_accounts };
    },
    scamPhonesSnapshot: async (
        _: any,
        { cursor, limit }: { cursor?: string | null; limit: number },
        ctx: any
      ) => {
      console.log("[Query] scamPhonesSnapshot");

      const since = cursor || "1970-01-01T00:00:00Z";

      const { rows } = await query(
        `
        SELECT *
        FROM scam_phones_summary
        WHERE updated_at > $1
        ORDER BY updated_at ASC
        LIMIT $2
        `,
        [since, limit]
      );

      const items = rows.map((r: any) => ({
        phone: r.phone,
        report_count: r.report_count,
        last_report_at: r.last_report_at,
        risk_level: r.risk_level,
        tags: [],
        updated_at: r.updated_at,
        is_deleted: r.is_deleted,   // 👈 ใช้จาก DB เลย
        post_ids: r.post_ids,
      }));

      const nextCursor =
        rows.length === limit ? rows[rows.length - 1].updated_at : null;

      return { cursor: nextCursor, items };
    },
    scamPhonesDelta: async (
      _: any,
      {
        cursor,
        limit,
        sinceVersion,
      }: { cursor?: string | null; limit: number; sinceVersion: string },
      ctx: any
    ) => {
      console.log("[Query] scamPhonesDelta", { cursor, sinceVersion, limit });

      // เลือก source ก่อน: cursor > sinceVersion
      const rawSince = cursor || sinceVersion;

      // รองรับ 2 แบบ:
      // 1) ISO string เช่น "2025-11-28T03:20:00.000Z"
      // 2) epoch milliseconds เช่น "1763734660728"
      let sinceParam: string;

      if (/^\d+$/.test(rawSince)) {
        // เป็นตัวเลขล้วน → แปลว่า epoch (ms หรือ s)
        const num = Number(rawSince);
        // ถ้าใหญ่กว่า 1e12 นิด ๆ ส่วนใหญ่คือ ms → แปลงเป็นวินาทีให้ JS
        const ms = num > 1e12 ? num : num * 1000;
        sinceParam = new Date(ms).toISOString();
      } else {
        // สมมติว่าเป็น ISO อยู่แล้ว
        sinceParam = rawSince;
      }

      const { rows } = await query(
        `
        SELECT
          tel,
          COUNT(*)               AS report_count,
          MAX(created_at)        AS last_report_at,
          MAX(created_at)        AS updated_at,
          ARRAY_AGG(DISTINCT post_id) AS post_ids
        FROM post_tel_numbers
        WHERE created_at > $1
        GROUP BY tel
        ORDER BY updated_at ASC
        LIMIT $2
        `,
        [sinceParam, limit]
      );

      const items = rows.map((r: any) => ({
        phone: r.tel,
        report_count: Number(r.report_count),
        last_report_at: r.last_report_at,
        risk_level: calcRisk(Number(r.report_count)),
        tags: [],
        updated_at: r.updated_at,
        is_deleted: false,
        post_ids: r.post_ids,
      }));

      // cursor หน้าใหม่ ส่งกลับเป็น ISO (string)
      const nextCursor =
        rows.length === limit && rows.length > 0
          ? rows[rows.length - 1].updated_at
          : null;

      return {
        cursor: nextCursor,
        items,
      };
    },
    searchScamPhones: async (_: any, { q, limit }: any, ctx: any) => {
      // const auth = requireAuth(ctx);
      // if (!auth.isAuthenticated) throw new Error("Unauthenticated");

      const term = normalizePhone(q) || String(q || "").trim();
      const lim = Math.max(1, Math.min(Number(limit || 30), 50));

      // ✅ เลือกเฉพาะคอลัมน์ที่ "มีจริง" ใน scam_phones_summary
      const { rows } = await query(
        `
        SELECT
          phone,
          report_count,
          last_report_at,
          risk_level,
          updated_at
        FROM scam_phones_summary
        WHERE phone ILIKE $1
        ORDER BY report_count DESC, last_report_at DESC NULLS LAST
        LIMIT $2
        `,
        [`%${term}%`, lim]
      );

      // ✅ เติม fields ที่ schema ต้องการ แต่ DB ไม่มี
      return rows.map((r: any) => ({
        phone: r.phone,
        report_count: Number(r.report_count || 0),
        last_report_at: r.last_report_at ? new Date(r.last_report_at).toISOString() : null,
        risk_level: Number(r.risk_level || 0),
        tags: [],            // <<<<<< สำคัญ
        is_deleted: false,   // <<<<<< สำคัญ (ถ้าไม่มีใน DB)
        post_ids: [],        // <<<<<< สำคัญ
        ctx: null,           // <<<<<< สำคัญ
        updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
      }));
    },
    searchBankAccounts: async (
      _: any,
      { q, limit = 20 }: { q: string; limit: number },
      ctx: any
    ) => {
      console.log("[Query] searchBankAccounts", { q, limit });

      const term = String(q || "").trim();
      if (!term) return [];

      const safeLimit = Math.min(Math.max(limit || 20, 1), 50);
      const qNorm = normalizeAccountNo(term);

      console.log("[Query][qNorm] searchBankAccounts", qNorm);

      const mapRow = async (r: any) => {
        const masked = maskAccount(r.account_no || r.account_norm);
        const postMeta = await getBankPostMeta(r.bank_name, r.account_norm);

        const lastReportISO = r.last_report_at
          ? new Date(r.last_report_at).toISOString()
          : null;

        const updatedISO = r.updated_at
          ? new Date(r.updated_at).toISOString()
          : lastReportISO;

        return {
          id: `${r.bank_name}:${r.account_norm}`,
          entity_id: `${r.bank_name}:${r.account_norm}`,
          ids: [],

          bank_name: r.bank_name,
          account_no_masked: masked,
          report_count: Number(r.report_count || 0),
          last_report_at: lastReportISO,

          // ✅ client fields
          account: String(r.account_norm || r.account_no || ""),
          risk_level:
            r.risk_level != null
              ? Number(r.risk_level)
              : calcRisk(Number(r.report_count || 0)),
          tags: [],
          updated_at: updatedISO,

          // ✅ ไม่มีคอลัมน์ใน DB ก็คืน default ไปเลย
          is_deleted: false,
          post_ids: postMeta.post_ids,
          post_count: postMeta.post_count,
          latest_post_id: postMeta.latest_post_id,
          ctx: null,
        };
      };

      // -------------------------
      // case 1) query เป็นเลข -> exact + prefix
      // -------------------------
      if (qNorm.length > 0) {
        const { rows } = await query(
          `
          SELECT
            bank_name,
            account_norm,
            account_no,
            report_count,
            last_report_at,
            risk_level,
            updated_at
          FROM scam_bank_accounts_summary
          WHERE
                account_norm = $1
            OR  account_norm LIKE ($1 || '%')
          ORDER BY
            CASE WHEN account_norm = $1 THEN 0 ELSE 1 END,
            report_count DESC,
            last_report_at DESC NULLS LAST
          LIMIT $2
          `,
          [qNorm, safeLimit]
        );

        return Promise.all(rows.map(mapRow));
      }

      // -------------------------
      // case 2) ไม่ใช่เลข -> bank_name prefix
      // -------------------------
      const likePrefix = `${term}%`;

      const { rows } = await query(
        `
        SELECT
          bank_name,
          account_norm,
          account_no,
          report_count,
          last_report_at,
          risk_level,
          updated_at
        FROM scam_bank_accounts_summary
        WHERE bank_name ILIKE $1
        ORDER BY report_count DESC, last_report_at DESC NULLS LAST
        LIMIT $2
        `,
        [likePrefix, safeLimit]
      );

      return Promise.all(rows.map(mapRow));
    },
    bankDetail: async (_: any, { bankCode, accountNo }: { bankCode: string; accountNo: string }, ctx: any) => {
      const auth = requireAuth(ctx, { optionalWeb: true, optionalAndroid: true });
      const userId = auth.isAuthenticated && auth.author_id ? String(auth.author_id) : null;
      const bankName = String(bankCode || "").trim() || "UNKNOWN";
      const accountNorm = normalizeBankAccount(accountNo);
      if (!accountNorm) {
        throw new GraphQLError("Invalid account");
      }

      const postMeta = await getBankPostMeta(bankName, accountNorm);
      const { rows } = await query(
        `
        SELECT
          bank_name,
          account_no,
          account_norm,
          report_count,
          last_report_at,
          risk_level,
          updated_at
        FROM scam_bank_accounts_summary
        WHERE bank_name = $1 AND account_norm = $2
        LIMIT 1
        `,
        [bankName, accountNorm]
      );

      const summary = rows[0] || {
        bank_name: bankName,
        account_no: accountNorm,
        account_norm: accountNorm,
        report_count: 0,
        last_report_at: null,
        risk_level: 0,
        updated_at: new Date().toISOString(),
      };

      let isReported = false;
      if (userId) {
        const reportRes = await query(
          `
          SELECT 1
          FROM scam_bank_account_reports
          WHERE user_id = $1::uuid
            AND bank_name = $2
            AND account_norm = $3
          LIMIT 1
          `,
          [userId, bankName, accountNorm]
        );
        isReported = reportRes.rows.length > 0;
      }

      return {
        bank_code: bankName,
        bank_name: String(summary.bank_name || bankName),
        account: accountNorm,
        report_count: Number(summary.report_count || 0),
        last_report_at: summary.last_report_at ? toIso(summary.last_report_at) : null,
        risk_level: Number(summary.risk_level || 0),
        updated_at: toIso(summary.updated_at),
        post_count: postMeta.post_count,
        latest_post_id: postMeta.latest_post_id,
        post_ids: postMeta.post_ids,
        is_reported: isReported,
        tags: [],
      };
    },
    relatedPostsByBank: async (_: any, { bankCode, accountNo, sort }: { bankCode: string; accountNo: string; sort?: RelatedPostsSort }, _ctx: any) => {
      return listRelatedPostIdsByBank(bankCode, accountNo, sort);
    },
    searchScamBankAccounts: async (_: any, { q, limit }: { q: string; limit: number }, ctx: any) => {
      const queryMap = resolvers.Query as unknown as Record<string, unknown>;
      const fn = queryMap.searchBankAccounts as
        | ((root: unknown, args: { q: string; limit: number }, ctx: unknown) => unknown)
        | undefined;

      if (!fn) {
        throw new Error("searchBankAccounts resolver not available");
      }

      return fn(_, { q, limit }, ctx);
    },
    myReportedPhones: async (
      _: any,
      { limit, offset }: { limit: number; offset: number },
      ctx: any
    ) => {
      const auth = requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new GraphQLError("Unauthenticated");
      }

      const userId = String(auth.author_id);
      const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
      const safeOffset = Math.max(Number(offset) || 0, 0);

      const { rows } = await query(
        `
        SELECT
          r.phone,
          r.phone_normalized,
          r.category,
          r.note,
          r.created_at,
          s.updated_at,
          COALESCE(s.report_count, 0) AS report_count,
          COALESCE(s.risk_level, 0) AS risk_level
        FROM scam_phone_reports r
        LEFT JOIN scam_phones_summary s
          ON s.phone = r.phone_normalized
        WHERE r.user_id = $1::uuid
        ORDER BY r.created_at DESC
        LIMIT $2 OFFSET $3
        `,
        [userId, safeLimit, safeOffset]
      );

      return (rows || []).map((row: any) => ({
        phone: String(row.phone || row.phone_normalized || ""),
        created_at: toIso(row.created_at),
        updated_at: toIso(row.updated_at, row.created_at),
        report_count: Number(row.report_count || 0),
        risk_level: Number(row.risk_level || 0),

        // ✅ DB ไม่มี tags ใน summary -> ให้ default เป็น []
        tags: [],

        // ✅ category ใน DB เป็น text -> ให้ normalize เป็น enum ที่ GraphQL รู้จัก
        category: (() => {
          const c = String(row.category || "").toUpperCase();
          if (["SPAM", "SCAM", "SALES", "HARASS", "OTHER"].includes(c)) return c;
          return "OTHER";
        })(),

        note: row.note ?? null,

        // ✅ DB ไม่มี post_id ใน reports -> ให้ null
        post_id: null,
      }));
    },

    myReportedPhoneKeys: async (_: any, _args: any, ctx: any) => {
      const auth = requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new GraphQLError("Unauthenticated");
      }

      const userId = String(auth.author_id);
      const { rows } = await query(
        `
        SELECT DISTINCT r.phone_normalized
        FROM scam_phone_reports r
        WHERE r.user_id = $1::uuid
        ORDER BY r.phone_normalized ASC
        `,
        [userId]
      );

      return (rows || [])
        .map((r: any) => String(r.phone_normalized || "").trim())
        .filter(Boolean);
    },
    myReportedBankAccounts: async (
        _: any,
        { limit, offset }: { limit: number; offset: number },
        ctx: any
      ) => {
      const auth = requireAuth(ctx);
      if (!auth?.isAuthenticated || !auth?.author_id) {
        throw new GraphQLError("Unauthenticated");
      }

      const userId = String(auth.author_id);
      const safeLimit = Math.min(Math.max(Number(limit) || 1, 1), 200);
      const safeOffset = Math.max(Number(offset) || 0, 0);

      // ✅ IMPORTANT: ตารางคุณชื่อ scam_bank_account_reports + scam_bank_accounts_summary
      // ✅ IMPORTANT: reports มี account_norm / created_at / note
      // ✅ IMPORTANT: summary มี report_count / risk_level / updated_at / last_report_at
      const { rows } = await query(
        `
        SELECT
          r.bank_name,
          r.account_no,
          r.account_norm,
          r.note,
          r.created_at,
          s.updated_at AS summary_updated_at,
          COALESCE(s.report_count, 0) AS report_count,
          COALESCE(s.risk_level, 0) AS risk_level
        FROM scam_bank_account_reports r
        LEFT JOIN scam_bank_accounts_summary s
          ON s.bank_name = r.bank_name
         AND s.account_norm = r.account_norm
        WHERE r.user_id = $1::uuid
        ORDER BY r.created_at DESC
        LIMIT $2 OFFSET $3
        `,
        [userId, safeLimit, safeOffset]
      );

      return rows.map((r: any) => {
        const acc = normalizeBankAccount(r.account_no || r.account_norm || "");
        const bankName = String(r.bank_name || "UNKNOWN");
        const createdAt = toIso(r.created_at) || new Date().toISOString();
        const updatedAt = toIso(r.summary_updated_at) || createdAt;

        return {
          account: acc,
          bank_name: bankName,
          created_at: createdAt,
          updated_at: updatedAt,
          report_count: Number(r.report_count || 0),
          risk_level: Number(r.risk_level || 0),

          // DB ไม่มี tags ใน summary ตามรูป
          tags: [],

          // DB ไม่มี category/post_id ใน reports ตามรูป
          category: null,
          post_id: null,

          note: r.note ?? null,
        };
      });
    },

    myReportedBankAccountKeys: async (_: any, _args: any, ctx: any) => {
      const auth = requireAuth(ctx);
      if (!auth?.isAuthenticated || !auth?.author_id) {
        throw new GraphQLError("Unauthenticated");
      }

      const userId = String(auth.author_id);
      const { rows } = await query(
        `
        SELECT DISTINCT r.account_norm
        FROM scam_bank_account_reports r
        WHERE r.user_id = $1::uuid
        ORDER BY r.account_norm ASC
        `,
        [userId]
      );

      return (rows || [])
        .map((r: any) => normalizeBankAccount(r.account_norm || ""))
        .filter(Boolean);
    },
    ...phoneResolvers.Query,
    ...contactSpamResolvers.Query,
    ...bmsOrdersResolvers.Query,
    ...bmsProductsResolvers.Query,
    ...bmsCustomersResolvers.Query,
    ...bmsDashboardResolvers.Query,
    ...bmsAiQualityResolvers.Query,
    ...bmsChannelsResolvers.Query,
    ...bmsAiConfigResolvers.Query,
    ...bmsSqlConsoleResolvers.Query,
    ...bmsStoreProfileResolvers.Query,
    ...bmsRevisionsResolvers.Query,
    ...bmsCouponsResolvers.Query,
    ...bmsReportScheduleResolvers.Query,
    ...bmsMailLogResolvers.Query,
    ...bmsSaasResolvers.Query,
    ...bmsPurchaseResolvers.Query,
    ...bmsPaymentsResolvers.Query,
    ...bmsShippingResolvers.Query,
    ...bmsInboxResolvers.Query,
    ...bmsReportsResolvers.Query,
    ...bmsCustomer360Resolvers.Query,
    ...bmsRestockSubscriptionsResolvers.Query,
  },
  Mutation: {
    login: async (_: any, { input }: { input: { email?: string; username?: string; password: string } }, ctx: any) => {
      
      console.log("[login]");
      const { email, username, password } = input || {};
      if (!password || (!email && !username)) {
        throw new Error("Email/Username and password are required");
      }

      // เลือกฟิลด์ที่ใช้ล็อกอิน: email (แนะนำ) หรือ username (ถ้ามีคอลัมน์นี้ใน users)
      // ตัวอย่างนี้ใช้ email เป็นหลัก
      const identifier = email?.trim().toLowerCase() || username?.trim();
      const idField = email ? "email" : "name"; // ถ้าอยากใช้ username จริง ๆ ให้มีคอลัมน์ username แยก

      // ตรวจสอบรหัสผ่านด้วย pgcrypto (bcrypt)
      const { rows } = await query(
        `
        SELECT id, name, email, role, avatar, phone
        FROM users
        WHERE ${idField} = $1
          AND password_hash = crypt($2, password_hash)
        LIMIT 1
        `,
        [identifier, password]
      );

      const user = rows[0];
      if (!user) {
        // ป้องกันการเดารหัส/บัญชี โดยไม่บอกว่า email หรือ password ผิด
        return { ok: false, message: "Invalid credentials" };
      }

      // // สร้าง token อย่างง่าย (ควรเปลี่ยนเป็น JWT/Session จริงในงานจริง)
      // const token = crypto.randomBytes(24).toString("base64url");

      // // ถ้าต้องการเก็บ session/token ใน DB ให้สร้างตาราง sessions แล้ว INSERT ที่นี่
      // // await query(`INSERT INTO sessions(user_id, token, expired_at) VALUES ($1,$2,NOW() + interval '7 days')`, [user.id, token]);

      // // ถ้าใช้ Next.js API route สามารถตั้ง cookie httpOnly ที่ layer ของ API ได้
      // // ctx.res?.setHeader("Set-Cookie", `token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);


      // สร้าง token ใหม่
      const token = crypto.randomBytes(32).toString("base64url");
      const ttlDays = TOKEN_TTL_DAYS;
      const ua = ctx?.req?.headers?.get?.("user-agent") || null;
      const ip =
        (ctx?.req?.headers?.get?.("x-forwarded-for") || "").split(",")[0].trim() ||
        ctx?.req?.ip ||
        null;

      // (ทางเลือก) ยกเลิก session เดิมของผู้ใช้ (ให้มี 1 session ต่อคน)
      // await query(`DELETE FROM sessions WHERE user_id=$1`, [user.id]);

      // แทรก session ใหม่
      await query(
        `
        INSERT INTO sessions (token, user_id, user_agent, ip, expired_at)
        VALUES ($1, $2, $3, $4, NOW() + ($5 || ' days')::interval)
        `,
        [token, user.id, ua, ip, String(ttlDays)]
      );

      // (ทางเลือกแนะนำ) ตั้ง httpOnly cookie ที่ชั้น Route/Handler
      // ctx.res?.setHeader("Set-Cookie", `token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttlDays*86400}`);


      return {
        ok: true,
        message: "Login success",
        token,
        user,
      };
    },
    loginUser: async (_: any, { input }: { input: { email?: string; username?: string; password: string } }, ctx: any) => {
      const { email, username, password } = input || {};
      if (!password || (!email && !username)) {
        throw new Error("Email/Username and password are required");
      }

      const emailNorm = email ? String(email).trim().toLowerCase() : null;
      const usernameNorm = username ? String(username).trim().toLowerCase() : null;

      const { rows } = emailNorm
        ? await query("SELECT * FROM users WHERE email=$1", [emailNorm])
        : await query("SELECT * FROM users WHERE username=$1", [usernameNorm]);
      const user = rows[0];

      if (!user) throw new Error("Invalid credentials");
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) throw new Error("Invalid credentials");

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      cookies().set(USER_COOKIE, token, { httpOnly: true, secure: useSecureCookie && !isDev, sameSite: "lax", path: "/" });
      return {
        ok: true,
        message: "Login success",
        token,
        user,
      };
    },
    loginWithSocial: async (_: any, { input }: any, ctx: any) => {
      const { provider, accessToken } = input;

      let socialData = null;

      if (provider === "google") {
        socialData = await verifyGoogle(accessToken);
      } else if (provider === "facebook") {
        socialData = await verifyFacebook(accessToken);
      } else {
        throw new GraphQLError("Invalid provider");
      }

      if (!socialData) {
        throw new GraphQLError("Social token invalid");
      }

      const { email, name, picture, provider_id } = socialData;

      /* ======================================================
            1) หา user ถ้ามี email อยู่แล้ว → login เลย
         ====================================================== */
      const { rows: existing } = await query(
        `SELECT * FROM users WHERE email = $1 LIMIT 1`,
        [email]
      );

      let user = existing[0];

      /* ======================================================
            2) ถ้ายังไม่มี user → สร้างใหม่
         ====================================================== */
      if (!user) {
        const randomPassword = crypto.randomBytes(16).toString("hex");

        const { rows: newUser } = await query(
          `
          INSERT INTO users (name, username, email, avatar, role, password_hash, provider, provider_id, meta)
          VALUES ($1,$2,$3,$4,'Subscriber', crypt($5, gen_salt('bf')),$6,$7,$8)
          RETURNING *
        `,
          [name, normalizeStr(email), email, picture, randomPassword, provider, provider_id, JSON.stringify(socialData || {})]
        );

        user = newUser[0];
      }

      /*
      web-1       | [loginWithSocial] @1 =  {
      web-1       |   email: 'android.somkid@gmail.com',
      web-1       |   name: 'Somkid Simajarn',
      web-1       |   picture: 'https://lh3.googleusercontent.com/a/ACg8ocJ1XvMZgNQRmpi7ceC4dIhQMd6f2AumSMhVvTXilWF8y7hVkJ8b=s96-c',
      web-1       |   provider: 'google',
      web-1       |   provider_id: 'xxxx'
      web-1       | }
      */

      /*
      web-1       | [loginWithSocial] =  {
      web-1       |   id: 'c2570057-d8bd-4506-9f00-0c7fc6996d52',
      web-1       |   name: 'Somkid Simajarn',
      web-1       |   avatar: 'https://lh3.googleusercontent.com/a/ACg8ocJ1XvMZgNQRmpi7ceC4dIhQMd6f2AumSMhVvTXilWF8y7hVkJ8b=s96-c',
      web-1       |   phone: null,
      web-1       |   email: 'android.somkid@gmail.com',
      web-1       |   role: 'Subscriber',
      web-1       |   created_at: 2025-11-13T16:57:50.060Z,
      web-1       |   password_hash: '$2a$06$owU1d10euSYJdLhqxZGyFekkLyJzgz9eIox9c7mv1pwGHRmvyTk0a',
      web-1       |   meta: null,
      web-1       |   fake_test: null,
      web-1       |   username: null,
      web-1       |   language: 'en',
      web-1       |   updated_at: 2025-11-13T16:57:50.060Z
      web-1       | }
      */

      /* ======================================================
            3) ออก JWT token
         ====================================================== */
         /*
      const token = signUserToken(user);

      return jwt.sign(
        {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        JWT_SECRET,
        { expiresIn: "30d" }
      );
      */

      //  id: user.id, email: user.email, role: user.role

      console.log("[loginWithSocial] @1 = ", socialData);
      console.log("[loginWithSocial] @2 = ", user);

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      cookies().set(USER_COOKIE, token, { httpOnly: true, secure: useSecureCookie && !isDev, sameSite: "lax", path: "/" });

      // แนะนำ: set cookie httpOnly ใน production
      // ctx.res.cookie("token", token, {
      //   httpOnly: true,
      //   sameSite: 'lax',
      //   path: '/'
      // });


      return {
        ok: true,
        message: "Login success",
        token,
        user,
      };
    },
    loginAdmin: async (_: any, { input }: { input: { email?: string; username?: string; password: string } }, ctx: any) => {
      const { email, username, password } = input || {};
      if (!password || (!email && !username)) {
        throw new Error("Email/Username and password are required");
      }

      const identifier = String(email || username || "").trim().toLowerCase();
      const { rows } = await query(
        `SELECT u.*, t.active AS tenant_active
           FROM users u
           LEFT JOIN bms_tenants t ON t.id = u.tenant_id
          WHERE lower(u.email) = $1 OR lower(u.username) = $1
          LIMIT 1`,
        [identifier]
      );
      const user = rows[0];

      if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
        throw new Error("Invalid credentials");
      }
      if (user.is_email_verified === false) throw new Error("Please verify your email before signing in");
      if (user.tenant_id && user.tenant_active === false) throw new Error("Shop is not active");

      // Administrator = full RBAC permissions → short-lived session; other staff roles get a longer one.
      // Keep this in sync with the cookie maxAge below — a JWT that outlives its cookie (or vice versa)
      // makes the two clocks disagree about when the session actually ends.
      const sessionMaxAgeSec = user.role === "Administrator" ? 60 * 60 * 24 : 60 * 60 * 24 * 7;

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role, tenant_id: user.tenant_id },
        JWT_SECRET,
        { expiresIn: sessionMaxAgeSec }
      );

      cookies().set(ADMIN_COOKIE, token, {
        httpOnly: true,
        secure: useSecureCookie && !isDev,
        sameSite: "lax",
        path: "/",
        maxAge: sessionMaxAgeSec,
      });

      // best-effort — พลาดตรงนี้ต้องไม่ทำให้ login ล้มเหลว (แค่แสดง last login ไม่ได้)
      query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]).catch((err) => {
        console.error("[loginAdmin] update last_login_at failed:", err);
      });

      return {
        ok: true,
        message: "Login success",
        token,
        user,
      };
    },
    registerUser: async(_: any, { input }: any) => {
      const { username, email, phone, password, agree } = input;
      if (!agree) throw new Error('Please accept terms');
      const { rows: exists } = await query('SELECT 1 FROM users WHERE email=$1', [email]);
      if (exists.length) throw new Error('Email already registered');

      const password_hash = await bcrypt.hash(password, 10);
      const usernameNorm = String(username || "").trim().toLowerCase();
      const emailNorm = String(email || "").trim().toLowerCase();
      const { rows: [u] } = await query(
        `INSERT INTO users(name, username, email, phone, role, password_hash, is_email_verified)
        VALUES($1,$2,$3,$4,'Subscriber',$5,FALSE) RETURNING id, name, username, email, role`,
        [usernameNorm, usernameNorm, emailNorm, phone, password_hash]
      );

      /* =========================
        CREATE VERIFY TOKEN
      ========================= */
      const rawToken = generateRawToken();        // ส่งให้ user
      const tokenHash = sha256Hex(rawToken);         // เก็บใน DB
      const expiryMinutes = 30;

      await query(
        `INSERT INTO email_verify_tokens(user_id, token_hash, expires_at)
        VALUES ($1, $2, now() + interval '${expiryMinutes} minutes')`,
        [u.id, tokenHash]
      );

      const verify_url =`${process.env.NEXT_PUBLIC_BASE_URL}/verify-email?token=${rawToken}`;

      /* =========================
        SEND EMAIL (template)
      ========================= */
      const locale = "en";
      const tpl = await getLatestEmailTemplate("auth.verify", locale);

      const rendered = renderEmailTemplate(tpl, {
        ...baseData(locale),
        user_name: u?.name ?? u?.username ?? emailNorm,
        verify_url,
        expiry_minutes: expiryMinutes,
      });

      await sendEmail(
        {
          to: email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        },
        { category: "auth", triggeredBy: "resolvers:registerUser" }
      );

      // sendMail

      const token = jwt.sign({ id: u.id, email: u.email, role: u.role }, JWT_SECRET, { expiresIn: '7d' });
      cookies().set(USER_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: useSecureCookie && !isDev, path: '/' });

      /* =========================
        CREATE ADMIN CHAT
        สร้าง chat กับ admin อัตโนมัติ — ลบไม่ได้
      ========================= */
      try {
        const { rows: [admin] } = await query(
          `SELECT id FROM users WHERE role = 'Administrator' ORDER BY created_at ASC LIMIT 1`
        );
        if (admin) {
          const [a, b] = [u.id, admin.id].sort();
          const directKey = `${a}:${b}`;
          await query(
            `INSERT INTO chats (name, is_group, created_by, direct_key, is_undeletable)
             VALUES (NULL, false, $1, $2, true)
             ON CONFLICT (direct_key) DO NOTHING`,
            [admin.id, directKey]
          );
          const { rows: [chat] } = await query(
            `SELECT id FROM chats WHERE direct_key = $1`, [directKey]
          );
          if (chat) {
            await query(
              `INSERT INTO chat_members (chat_id, user_id)
               VALUES ($1, $2), ($1, $3)
               ON CONFLICT DO NOTHING`,
              [chat.id, u.id, admin.id]
            );
          }
        }
      } catch (e) {
        // ไม่ throw — การสมัครสำเร็จแม้สร้าง chat ไม่ได้
        console.error('[registerUser] failed to create admin chat', e);
      }

      return true;
    },
    requestPasswordReset: async (_: any, { email }: { email: string }, ctx: any) => {
      // 1) หา user จากอีเมล (อย่า leak ว่ามี/ไม่มี)
      const { rows } = await query(
        `SELECT id, email, name, language FROM users WHERE email = $1 LIMIT 1`,
        [email]
      );

      if (rows.length === 0) {
        return true; // กัน enumeration
      }

      const user = rows[0];

      // 2) สร้าง token + insert (ของคุณมีอยู่แล้ว)
      const { token, expiresAt } = await createResetToken(user.id);
      // ถ้า createResetToken ของคุณยังไม่ return expiresAt -> ไม่เป็นไร (ใช้ default 30 นาทีใน email ได้)

      // 3) สร้างลิงก์ไปหน้า /reset
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://yourapp.com";
      const resetUrl = `${baseUrl}/reset?token=${encodeURIComponent(token)}`;

      // 4) meta สำหรับ email (optional)
      const requestIp =
        ctx?.ip ||
        ctx?.req?.headers?.["x-forwarded-for"] ||
        ctx?.req?.socket?.remoteAddress ||
        "-";

      const requestDevice = ctx?.req?.headers?.["user-agent"] || "-";

      // 5) ส่งเมลผ่าน template ใน PG + SendGrid
      await sendPasswordResetEmail({
        to: user.email,
        locale: user.language ?? "en",
        userName: user.name ?? user.email,
        resetUrl,
        expiryMinutes: 30, // หรือคำนวณจาก expiresAt ถ้ามี
        requestIp: String(requestIp),
        requestDevice: String(requestDevice),
        requestTime: new Date().toISOString(),
      });

      return true;
    },
    resetPassword: async(_: any, { token, newPassword }: { token: string; newPassword: string }, ctx: any)=>{
      // 1) หา token
      const { rows } = await query(
        `SELECT prt.id, prt.user_id, prt.expires_at, prt.used
           FROM password_reset_tokens prt
           WHERE prt.token = $1`,
        [token]
      );
      if (rows.length === 0) throw new Error("Invalid token");

      const t = rows[0];
      if (t.used) throw new Error("Token already used");
      if (new Date(t.expires_at).getTime() < Date.now()) throw new Error("Token expired");

      // Keep the reset path compatible with every password-based login path.
      const password_hash = await bcrypt.hash(newPassword, 10);
      await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [password_hash, t.user_id]);

      // 3) มาร์ค token เป็นใช้แล้ว
      await query(`UPDATE password_reset_tokens SET used = true WHERE id = $1`, [t.id]);

      // (ออปชัน) revoke sessions อื่นๆ ของ user นี้

      return true;
    },
    verifyEmail: async (_: any, { token }: { token: string }) => {
      const tokenHash = sha256Hex(token);

      const { rows } = await query(
        `
        SELECT evt.id, evt.user_id
        FROM email_verify_tokens evt
        WHERE evt.token_hash = $1
          AND evt.used_at IS NULL
          AND evt.expires_at > now()
        LIMIT 1
        `,
        [tokenHash]
      );

      if (!rows[0]) {
        return { ok: false, message: "Invalid or expired token" };
      }

      const { id: tokenId, user_id } = rows[0];

      await query(`UPDATE users SET is_email_verified = true WHERE id = $1`, [
        user_id,
      ]);

      await query(
        `UPDATE email_verify_tokens SET used_at = now() WHERE id = $1`,
        [tokenId]
      );

      return { ok: true, message: "Email verified successfully" };
    },
    // resolver ตัวอย่าง
    updateMe: async (_:any, { data }: { data: any }, ctx:any) => {
      const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const { name, phone, username, language, gender, notifications_enabled } = data;
      // gender รับเฉพาะ 'male'/'female'/null (ไม่งั้นไม่แตะค่าเดิม)
      const genderVal = gender === "male" || gender === "female" ? gender : null;

      console.log("[Mutation] updateMe :", author_id, name, phone, username, language, gender, notifications_enabled );
      const { rows } = await query(
        `UPDATE users SET
          name = COALESCE($1, name),
          phone = COALESCE($2, phone),
          language = COALESCE($3, language),
          gender = COALESCE($4, gender),
          notifications_enabled = COALESCE($5, notifications_enabled),
          updated_at = NOW()
        WHERE id = $6
        RETURNING id, name, email, phone, username, language, gender, avatar, notifications_enabled`,
        [name, phone, language, genderVal, notifications_enabled, author_id]
      );
      return rows[0];
    },
    // upsertPost: async (
    //   _: any,
    //   { id, data, images, image_ids_delete }: {
    //     id?: string;
    //     data: any;
    //     images?: Array<Promise<GraphQLUploadFile>>;
    //     image_ids_delete?: Array<string | number>;
    //   },
    //   ctx: any
    // ) => {
    //   const { author_id, scope, isAuthenticated } = requireAuth(ctx);
    //   console.log("[Mutation] upsertPost :", author_id, data, image_ids_delete);

    //   const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
    //     let postId: string;

    //     // ============================================================
    //     // 1) UPSERT POSTS
    //     // ============================================================
    //     const commonFields = [
    //       data.first_last_name || null,
    //       data.id_card || null,
    //       data.title || null,
    //       data.transfer_amount || 0,
    //       data.transfer_date ? new Date(data.transfer_date) : null,
    //       data.website || null,
    //       data.province_id || null,
    //       data.detail || null,
    //       data.status || "public",
    //     ];

    //     if (id) {
    //       const { rows } = await client.query(
    //         `UPDATE posts
    //           SET first_last_name=$1, id_card=$2, title=$3,
    //               transfer_amount=$4, transfer_date=$5, website=$6,
    //               province_id=$7, detail=$8, status=$9,
    //               updated_at=NOW()
    //         WHERE id=$10
    //         RETURNING id`,
    //         [...commonFields, id]
    //       );
    //       postId = rows[0].id;
    //     } else {
    //       const { rows } = await client.query(
    //         `INSERT INTO posts (
    //           first_last_name, id_card, title,
    //           transfer_amount, transfer_date, website,
    //           province_id, detail,
    //           status, author_id, created_at, updated_at
    //         ) VALUES (
    //           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()
    //         )
    //         RETURNING id`,
    //         [...commonFields, author_id]
    //       );
    //       postId = rows[0].id;
    //     }

    //     // ============================================================
    //     // 2) TEL NUMBERS (insert/update/delete)
    //     // ============================================================
    //     if (Array.isArray(data.tel_numbers)) {
    //       console.log(`[TEL_SYNC] Incoming tel_numbers count = ${data.tel_numbers.length}`);

    //       for (const tel of data.tel_numbers) {
    //         const mode = tel.mode?.toLowerCase();
    //         const telId = tel.id;
    //         const phone = tel.tel;
    //         const post = postId;

    //         console.log(
    //           `[TEL_SYNC] mode=${mode} | id=${telId} | tel="${phone}" | postId=${post}`
    //         );

    //         if (mode === "deleted") {
    //           console.log(
    //             `[TEL_DELETE] DELETE FROM post_tel_numbers WHERE id=${telId} AND post_id=${post}`
    //           );

    //           await client.query(
    //             `DELETE FROM post_tel_numbers WHERE id=$1 AND post_id=$2`,
    //             [telId, post]
    //           );

    //           console.log(`[TEL_DELETE] success id=${telId}`);

    //         } else if (mode === "edited") {
    //           console.log(
    //             `[TEL_UPDATE] UPDATE post_tel_numbers SET tel="${phone}" WHERE id=${telId} AND post_id=${post}`
    //           );

    //           await client.query(
    //             `UPDATE post_tel_numbers SET tel=$1 WHERE id=$2 AND post_id=$3`,
    //             [phone, telId, post]
    //           );

    //           console.log(`[TEL_UPDATE] success id=${telId}, newTel="${phone}"`);

    //         } else if (mode === "new") {
    //           console.log(
    //             `[TEL_INSERT] INSERT INTO post_tel_numbers (post_id, tel) VALUES (${post}, "${phone}")`
    //           );

    //           await client.query(
    //             `INSERT INTO post_tel_numbers (post_id, tel)
    //             VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    //             [post, phone]
    //           );

    //           console.log(`[TEL_INSERT] success tel="${phone}"`);
    //         } else {
    //           console.warn(`[TEL_SYNC] Unknown mode="${mode}" for id=${telId}`);
    //         }
    //       }
    //     }


    //     // ============================================================
    //     // 3) SELLER ACCOUNTS (insert/update/delete)
    //     // ============================================================
    //     if (Array.isArray(data.seller_accounts)) {
    //       for (const acc of data.seller_accounts) {
    //         if (acc.mode === "deleted") {
    //           await client.query(`DELETE FROM post_seller_accounts WHERE id=$1 AND post_id=$2`, [acc.id, postId]);
    //         } else if (acc.mode === "edited") {
    //           await client.query(
    //             `UPDATE post_seller_accounts
    //               SET bank_id=$1, bank_name=$2, seller_account=$3
    //             WHERE id=$4 AND post_id=$5`,
    //             [acc.bank_id, acc.bank_name, acc.seller_account || "", acc.id, postId]
    //           );
    //         } else if (acc.mode === "new") {
    //           await client.query(
    //             `INSERT INTO post_seller_accounts (post_id, bank_id, bank_name, seller_account)
    //             VALUES ($1,$2,$3,$4)
    //             ON CONFLICT DO NOTHING`,
    //             [postId, acc.bank_id, acc.bank_name, acc.seller_account || ""]
    //           );
    //         }
    //       }
    //     }

    //     // ============================================================
    //     // 4) ลบรูปเก่า (ถ้ามี)
    //     // ============================================================
    //     if (image_ids_delete?.length) {
    //       await client.query(
    //         `DELETE FROM post_images WHERE post_id = $1 AND file_id = ANY($2::int[])`,
    //         [postId, image_ids_delete.map((id: any) => parseInt(id, 10))]
    //       );
    //     }

    //     // ============================================================
    //     // 5) เพิ่มรูปใหม่ (stream)
    //     // ============================================================
    //     if (images?.length) {
    //       const fileRows: any[] = [];

    //       for (const pf of images) {
    //         const upload = await pf; // GraphQLUploadFile

    //         const ext = path.extname(upload.filename || "");
    //         const renameTo = `post-${postId}-${Date.now()}${ext || ""}`;

    //         const row = await persistUploadStream(upload, renameTo);
    //         fileRows.push(row);
    //       }

    //       if (fileRows.length) {
    //         const values = fileRows.map((_, i) => `($1, $${i + 2})`).join(", ");
    //         await client.query(
    //           `INSERT INTO post_images (post_id, file_id) VALUES ${values}`,
    //           [postId, ...fileRows.map((r) => r.id)]
    //         );
    //       }
    //     }

    //     // ============================================================
    //     // 6) ดึงข้อมูลโพสต์กลับพร้อมรูป
    //     // ============================================================
    //     const { rows: posts } = await client.query(`SELECT * FROM posts WHERE id=$1`, [postId]);
    //     const { rows: imgs } = await client.query(
    //       `SELECT f.id, f.relpath
    //         FROM post_images pi
    //         JOIN files f ON f.id = pi.file_id
    //         WHERE pi.post_id=$1
    //         ORDER BY pi.id`,
    //       [postId]
    //     );

    //     // ============================================================
    //     // 7) LOG
    //     // ============================================================
    //     await addLog(
    //       "info",
    //       id ? "post-update" : "post-create",
    //       id ? "User updated a post" : "User created a post",
    //       { author_id, postId }
    //     );

    //     // ============================================================
    //     // RETURN
    //     // ============================================================
    //     return {
    //       ...posts[0],
    //       images: imgs.map((r: any) => ({
    //         id: r.id,
    //         url: buildFileUrlById(r.id),
    //       })),
    //     };
    //   });

    //   return result;
    // },

  upsertPost: async (
      _: any,
      {
        id,
        data,
        images,
        image_ids_delete,
      }: {
        id?: string;
        data: any;
        images?: Array<Promise<GraphQLUploadFile>>;
        image_ids_delete?: Array<string | number>;
      },
      ctx: any
    ) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] upsertPost :", author_id, data, image_ids_delete);

      // ✅ ให้เก็บ postId ไว้ใช้ emit หลัง commit
      let finalPostId: string | null = null;
      let finalTitle: string | null = null;
      let finalSummary: string | null = null;
      let finalUrl: string | null = null;
      let finalAutoPublish: boolean | null = null;

      // ✅ NEW: เก็บ tel_numbers ที่ “สถานะล่าสุดหลัง sync”
      let finalTelNumbers: Array<{ id: number; tel: string }> | null = null;

      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        let postId: string;

        // ============================================================
        // 1) UPSERT POSTS
        // ============================================================
        // ✅ normalize auto_publish ให้เป็น boolean แน่นอน
        const autoPublish =
          typeof data.auto_publish === "boolean"
            ? data.auto_publish
            : data.auto_publish == null
              ? true
              : String(data.auto_publish).toLowerCase() === "true" || String(data.auto_publish) === "1";

        const commonFields = [
          data.first_last_name || null, // $1
          data.id_card || null, // $2
          data.title || null, // $3
          data.transfer_amount || 0, // $4
          data.transfer_date ? new Date(data.transfer_date) : null, // $5
          data.website || null, // $6
          data.province_id || null, // $7
          data.detail || null, // $8
          data.status || "public", // $9
          autoPublish, // $10 ✅ NEW
        ];

        if (id) {
          const { rows } = await client.query(
            `UPDATE posts
              SET first_last_name=$1, id_card=$2, title=$3,
                  transfer_amount=$4, transfer_date=$5, website=$6,
                  province_id=$7, detail=$8, status=$9,
                  auto_publish=$10,
                  updated_at=NOW()
            WHERE id=$11
            RETURNING id`,
            [...commonFields, id]
          );
          postId = rows[0].id;
        } else {
          const { rows } = await client.query(
            `INSERT INTO posts (
              first_last_name, id_card, title,
              transfer_amount, transfer_date, website,
              province_id, detail,
              status, auto_publish,
              author_id, created_at, updated_at
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW()
            )
            RETURNING id`,
            [...commonFields, author_id]
          );
          postId = rows[0].id;
        }

        // ============================================================
        // 2) TEL NUMBERS (insert/update/delete)
        // ============================================================
        const hasTelNumbers = Array.isArray(data.tel_numbers);

        if (hasTelNumbers) {
          console.log(`[TEL_SYNC] Incoming tel_numbers count = ${data.tel_numbers.length}`);

          for (const tel of data.tel_numbers) {
            const mode = String(tel.mode ?? "").toLowerCase();
            const telId = tel.id;
            const phone = tel.tel;
            const post = postId;

            console.log(`[TEL_SYNC] mode=${mode} | id=${telId} | tel="${phone}" | postId=${post}`);

            if (mode === "deleted") {
              console.log(`[TEL_DELETE] DELETE FROM post_tel_numbers WHERE id=${telId} AND post_id=${post}`);
              await client.query(`DELETE FROM post_tel_numbers WHERE id=$1 AND post_id=$2`, [telId, post]);
              console.log(`[TEL_DELETE] success id=${telId}`);
            } else if (mode === "edited") {
              console.log(`[TEL_UPDATE] UPDATE post_tel_numbers SET tel="${phone}" WHERE id=${telId} AND post_id=${post}`);
              await client.query(`UPDATE post_tel_numbers SET tel=$1 WHERE id=$2 AND post_id=$3`, [
                phone,
                telId,
                post,
              ]);
              console.log(`[TEL_UPDATE] success id=${telId}, newTel="${phone}"`);
            } else if (mode === "new") {
              console.log(`[TEL_INSERT] INSERT INTO post_tel_numbers (post_id, tel) VALUES (${post}, "${phone}")`);
              await client.query(
                `INSERT INTO post_tel_numbers (post_id, tel)
                VALUES ($1,$2) ON CONFLICT DO NOTHING`,
                [post, phone]
              );
              console.log(`[TEL_INSERT] success tel="${phone}"`);
            } else {
              console.warn(`[TEL_SYNC] Unknown mode="${mode}" for id=${telId}`);
            }
          }
        }

        // ✅ NEW: ดึง tel_numbers ล่าสุดจาก DB (หลัง sync) เพื่อเอาไป emit
        let telRows: Array<{ id: number; tel: string }> = [];
        if (hasTelNumbers) {
          const { rows } = await client.query(
            `SELECT id, tel
            FROM post_tel_numbers
            WHERE post_id=$1
            ORDER BY id`,
            [postId]
          );
          telRows = rows ?? [];
        }

        // ============================================================
        // 3) SELLER ACCOUNTS (insert/update/delete)
        // ============================================================
        if (Array.isArray(data.seller_accounts)) {
          for (const acc of data.seller_accounts) {
            const mode = String(acc.mode ?? "").toLowerCase();

            if (mode === "deleted") {
              await client.query(`DELETE FROM post_seller_accounts WHERE id=$1 AND post_id=$2`, [acc.id, postId]);
            } else if (mode === "edited") {
              await client.query(
                `UPDATE post_seller_accounts
                  SET bank_id=$1, bank_name=$2, seller_account=$3
                WHERE id=$4 AND post_id=$5`,
                [acc.bank_id, acc.bank_name, acc.seller_account || "", acc.id, postId]
              );
            } else if (mode === "new") {
              await client.query(
                `INSERT INTO post_seller_accounts (post_id, bank_id, bank_name, seller_account)
                VALUES ($1,$2,$3,$4)
                ON CONFLICT DO NOTHING`,
                [postId, acc.bank_id, acc.bank_name, acc.seller_account || ""]
              );
            }
          }
        }

        // ============================================================
        // 4) ลบรูปเก่า (ถ้ามี)
        // ============================================================
        if (image_ids_delete?.length) {
          await client.query(
            `DELETE FROM post_images WHERE post_id = $1 AND file_id = ANY($2::int[])`,
            [postId, image_ids_delete.map((id: any) => parseInt(id, 10))]
          );
        }

        // ============================================================
        // 5) เพิ่มรูปใหม่ (stream)
        // ============================================================
        if (images?.length) {
          const fileRows: any[] = [];

          for (const pf of images) {
            const upload = await pf; // GraphQLUploadFile
            const ext = path.extname(upload.filename || "");
            const renameTo = `post-${postId}-${Date.now()}${ext || ""}`;

            const row = await persistUploadStream(upload, renameTo);
            fileRows.push(row);
          }

          if (fileRows.length) {
            const values = fileRows.map((_, i) => `($1, $${i + 2})`).join(", ");
            await client.query(`INSERT INTO post_images (post_id, file_id) VALUES ${values}`, [
              postId,
              ...fileRows.map((r) => r.id),
            ]);
          }
        }

        // ============================================================
        // 6) ดึงข้อมูลโพสต์กลับพร้อมรูป
        // ============================================================
        const { rows: posts } = await client.query(`SELECT * FROM posts WHERE id=$1`, [postId]);
        const { rows: imgs } = await client.query(
          `SELECT f.id, f.relpath
            FROM post_images pi
            JOIN files f ON f.id = pi.file_id
            WHERE pi.post_id=$1
            ORDER BY pi.id`,
          [postId]
        );

        // ============================================================
        // 7) LOG
        // ============================================================
        await addLog("info", id ? "post-update" : "post-create", id ? "User updated a post" : "User created a post", {
          author_id,
          postId,
        });

        // ============================================================
        // RETURN
        // ============================================================
        const out: any = {
          ...posts[0],
          images: imgs.map((r: any) => ({
            id: r.id,
            url: buildFileUrlById(r.id),
          })),
        };

        // ✅ ใส่ tel_numbers ในผลลัพธ์ด้วย (ถ้ามีส่งมา)
        if (hasTelNumbers) {
          out.tel_numbers = telRows.map((t) => ({ id: t.id, tel: t.tel }));
        }

        // ✅ เก็บค่าที่ต้องใช้หลัง commit
        finalPostId = out.id;
        finalTitle = out.title ?? null;
        finalSummary = out.detail ?? null;
        finalUrl = out.website ?? null;
        finalAutoPublish = typeof out.auto_publish === "boolean" ? out.auto_publish : null;

        // ✅ NEW: เก็บ tel_numbers ล่าสุดเพื่อ emit
        finalTelNumbers = hasTelNumbers ? out.tel_numbers ?? [] : null;

        return out;
      });

      console.log("[upsertPost] = ", result);

      // ============================================================
      // ✅ EMIT EVENT (หลัง commit เท่านั้น)
      // ============================================================
      try {
        const eventName = id ? "post.updated" : "post.created";

        if (finalPostId) {
          const payload: any = {
            eventId: randomUUID(),
            occurredAt: new Date().toISOString(),

            postId: finalPostId,
            actorId: String(author_id),
            revisionId,

            title: finalTitle ?? null,
            summary: finalSummary ?? null,
            url: finalUrl ?? null,

            // ✅ สำคัญ: ส่ง auto_publish ให้ worker
            auto_publish: finalAutoPublish ?? null,

            images: (result?.images ?? []).map((img: any) => ({
              id: img.id,
              url: img.url,
            })),
          };

          // ✅ NEW: ถ้า request มี data.tel_numbers ให้ emit tel_numbers ไปด้วย
          if (Array.isArray(data?.tel_numbers)) {
            payload.tel_numbers = Array.isArray(finalTelNumbers) ? finalTelNumbers : [];
          }

          console.log("[upsertPost][payload] = ", payload);

          await emitPostEvent(eventName, payload);
        }
      } catch (e: any) {
        console.error("[events] emit failed (ignored)", e?.message ?? e);
      }

      return result;
    },
    deletePost: async (_: any, { id }: { id: string }, ctx: any) => {
      // const { author_id } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] deletePost :", author_id, id);

      type PostSnap = {
        postId: string;
        title?: string | null;
        summary?: string | null;
        url?: string | null;
        images?: Array<{ id: number | string; url: string }>;
        auto_publish?: boolean | null;
      };

      const { revisionId, result } = await runInTransaction<{ ok: boolean; snap: PostSnap | null }>(
        author_id,
        async (client) => {
          // ✅ 0) snapshot ก่อนลบ
          const { rows: posts } = await client.query(
            `SELECT id, title, detail, website, auto_publish
            FROM posts
            WHERE id = $1`,
            [id]
          );

          if (!posts?.[0]) {
            return { ok: false, snap: null };
          }

          const p = posts[0];

          const { rows: imgs } = await client.query(
            `SELECT f.id, f.relpath
            FROM post_images pi
            JOIN files f ON f.id = pi.file_id
            WHERE pi.post_id = $1
            ORDER BY pi.id`,
            [id]
          );

          const snap: PostSnap = {
            postId: p.id,
            title: p.title ?? null,
            summary: p.detail ?? null,
            url: p.website ?? null,
            auto_publish: p.auto_publish ?? null,
            images: imgs.map((r: any) => ({
              id: r.id,
              url: buildFileUrlById(r.id),
            })),
          };

          // ✅ 1) ลบโพสต์
          const res = await client.query(`DELETE FROM posts WHERE id = $1`, [id]);

          // ✅ 2) log
          await addLog("info", "post-delete", "User deleted post", {
            author_id,
            postId: id,
            affectedRows: res.rowCount,
          });

          const ok = (res.rowCount ?? 0) === 1;
          return { ok, snap: ok ? snap : null };
        }
      );

      // ✅ 3) emit หลัง commit เท่านั้น
      try {
        if (result.ok && result.snap) {
          const snap = result.snap;
          await emitPostEvent("post.deleted", {
            eventId: randomUUID(),
            occurredAt: new Date().toISOString(),

            postId: snap.postId,
            actorId: String(author_id),
            revisionId,

            title: snap.title ?? null,
            summary: snap.summary ?? null,
            url: snap.url ?? null,
            auto_publish: snap.auto_publish ?? null,
            images: snap.images ?? [],
          });
        }
      } catch (e: any) {
        console.error("[events] emit post.deleted failed (ignored)", e?.message ?? e);
      }

      return result.ok;
    },
    deletePosts: async (_: any, { ids }: { ids: string[] }, ctx: any) => {
      // const { author_id } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] deletePosts :", author_id, ids?.length);

      if (!Array.isArray(ids) || ids.length === 0) {
        throw new GraphQLError("No IDs provided", { extensions: { code: "BAD_USER_INPUT" } });
      }

      const validIds = ids.filter((id) => /^[0-9a-fA-F-]{36}$/.test(id));
      if (validIds.length === 0) {
        throw new GraphQLError("Invalid UUIDs", { extensions: { code: "BAD_USER_INPUT" } });
      }

      // เก็บ snapshot หลัง commit
      let snaps: Array<{
        postId: string;
        title?: string | null;
        summary?: string | null;
        url?: string | null;
        images?: Array<{ id: number | string; url: string }>;
        auto_publish?: boolean | null;
      }> = [];

      const { revisionId, result } = await runInTransaction<boolean>(author_id, async (client, ctx) => {
        // ✅ 0) snapshot ของทุก post ก่อนลบ
        const { rows: posts } = await client.query(
          `SELECT id, title, detail, website, auto_publish
          FROM posts
          WHERE id = ANY($1::uuid[])`,
          [validIds]
        );

        if (!posts?.length) return false;

        const postIds = posts.map((p: any) => p.id);

        const { rows: imgs } = await client.query(
          `SELECT pi.post_id, f.id AS file_id
          FROM post_images pi
          JOIN files f ON f.id = pi.file_id
          WHERE pi.post_id = ANY($1::uuid[])
          ORDER BY pi.id`,
          [postIds]
        );

        const imagesByPost = new Map<string, Array<{ id: number | string; url: string }>>();
        for (const r of imgs) {
          const arr = imagesByPost.get(r.post_id) ?? [];
          arr.push({ id: r.file_id, url: buildFileUrlById(r.file_id) });
          imagesByPost.set(r.post_id, arr);
        }

        snaps = posts.map((p: any) => ({
          postId: p.id,
          title: p.title ?? null,
          summary: p.detail ?? null,
          url: p.website ?? null,
          auto_publish: p.auto_publish ?? null,
          images: imagesByPost.get(p.id) ?? [],
        }));

        // ✅ 1) ลบ
        const res = await client.query(`DELETE FROM posts WHERE id = ANY($1::uuid[])`, [validIds]);
        const deletedCount = res.rowCount ?? 0;

        // ✅ 2) log
        await addLog("info", "post-delete", `Deleted ${deletedCount} posts`, {
          userId: author_id,
          deletedCount,
          postIds: validIds,
        });

        return deletedCount > 0;
      });

      // ✅ 3) emit หลัง commit: ยิงทีละโพสต์
      try {
        if (result && snaps.length) {
          for (const s of snaps) {
            await emitPostEvent("post.deleted", {
              eventId: randomUUID(),
              occurredAt: new Date().toISOString(),

              postId: s.postId,
              actorId: String(author_id),
              revisionId,

              title: s.title ?? null,
              summary: s.summary ?? null,
              url: s.url ?? null,
              auto_publish: s.auto_publish ?? null,
              images: s.images ?? [],
            });
          }
        }
      } catch (e: any) {
        console.error("[events] emit post.deleted (bulk) failed (ignored)", e?.message ?? e);
      }

      return result;
    },
    clonePost: async (
      _: any,
      { id }: { id: string },
      ctx: any
    ) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] clonePost :", author_id, id);

      const { revisionId, result } =  await runInTransaction(author_id, async (client, ctx) => {
        // ==================================
        // 1) หา source post
        // ==================================
        const { rows: srcPosts } = await client.query(
          `SELECT *
          FROM posts
          WHERE id = $1`,
          [id]
        );
        if (!srcPosts.length) {
          throw new Error("Source post not found");
        }
        const src = srcPosts[0];

        // ==================================
        // 2) insert post ใหม่
        // ==================================
        const { rows: newPostRows } = await client.query(
          `INSERT INTO posts (
            first_last_name,
            id_card,
            title,
            transfer_amount,
            transfer_date,
            website,
            province_id,
            detail,
            status,
            author_id,
            created_at,
            updated_at
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()
          )
          RETURNING id`,
          [
            src.first_last_name,
            src.id_card,
            (src.title || "") + " Clone",
            src.transfer_amount,
            src.transfer_date,
            src.website,
            src.province_id,
            src.detail,
            src.status,
            author_id,
          ]
        );

        const newPostId = newPostRows[0].id;

        // ==================================
        // 3) clone tel_numbers
        // ==================================
        const { rows: srcTels } = await client.query(
          `SELECT tel FROM post_tel_numbers WHERE post_id=$1`,
          [id]
        );
        if (srcTels.length) {
          const values = srcTels.map((_:any, i:any) => `($1, $${i + 2})`).join(", ");
          await client.query(
            `INSERT INTO post_tel_numbers (post_id, tel)
            VALUES ${values}`,
            [newPostId, ...srcTels.map((r:any) => r.tel)]
          );
        }

        // ==================================
        // 4) clone seller_accounts
        // ==================================
        const { rows: srcAccs } = await client.query(
          `SELECT bank_id, bank_name, seller_account
          FROM post_seller_accounts
          WHERE post_id=$1`,
          [id]
        );
        if (srcAccs.length) {
          const values = srcAccs
            .map((_:any, i:any) => {
              const base = 1 + i * 3;
              return `($1, $${base + 1}, $${base + 2}, $${base + 3})`;
            })
            .join(", ");

          const params: any[] = [newPostId];
          srcAccs.forEach((r:any) => {
            params.push(r.bank_id, r.bank_name, r.seller_account || "");
          });

          await client.query(
            `INSERT INTO post_seller_accounts
              (post_id, bank_id, bank_name, seller_account)
            VALUES ${values}`,
            params
          );
        }

        // ==================================
        // 5) clone images
        // ==================================
        const { rows: srcImgs } = await client.query(
          `SELECT file_id
          FROM post_images
          WHERE post_id=$1
          ORDER BY id`,
          [id]
        );
        if (srcImgs.length) {
          const values = srcImgs.map((_:any, i:any) => `($1, $${i + 2})`).join(", ");
          await client.query(
            `INSERT INTO post_images (post_id, file_id)
            VALUES ${values}`,
            [newPostId, ...srcImgs.map((r:any) => r.file_id)]
          );
        }

        // ==================================
        // 6) LOG
        // ==================================
        await addLog(
          "info",
          "post-clone",
          "User cloned a post",
          { author_id, source_post_id: id, cloned_post_id: newPostId }
        );

        // ❗ สำคัญ: RETURN เป็น string ตรง ๆ ไม่ห่อ object ใด ๆ
        return newPostId;
      });

      return result;
    },
    createChat: async (
      _: any,
      { name, isGroup, memberIds }: { name?: string; isGroup: boolean; memberIds: string[] },
      ctx: any
    ) => {
      // const { author_id } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] createChat :", author_id);

      const { result } = await runInTransaction(author_id, async (client, ctx) => {
        // 1) normalize members (รวม creator)
        const incoming = Array.isArray(memberIds) ? memberIds.filter(Boolean) : [];
        const allMembers = Array.from(new Set([author_id, ...incoming]));

        // 2) directKey สำหรับ 1:1
        let directKey: string | null = null;

        if (!isGroup) {
          if (allMembers.length !== 2) {
            throw new Error("1:1 chat ต้องมีสมาชิก 2 คน (รวมผู้สร้าง)");
          }
          const [a, b] = [...allMembers].sort();
          directKey = `${a}:${b}`;
        }

        // 3) INSERT / UPSERT กันซ้ำ
        // no-op update เพื่อให้ RETURNING ทำงาน โดยไม่ต้องมี updated_at
        const { rows: chatRows } = await client.query(
          `
          INSERT INTO chats (name, is_group, created_by, direct_key)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (direct_key)
          DO UPDATE SET direct_key = chats.direct_key
          RETURNING *, (xmax = 0) AS is_new
          `,
          [
            isGroup ? (name || null) : null, // 1:1 ไม่ตั้ง name (กันสับสน)
            isGroup,
            author_id,
            directKey,
          ]
        );

        const chat = chatRows[0];
        const isNew = !!chat.is_new;

        // 4) เพิ่มสมาชิก
        for (const uid of allMembers) {
          await client.query(
            `
            INSERT INTO chat_members (chat_id, user_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
            `,
            [chat.id, uid]
          );
        }

        // 5) ดึง creator + members
        const creator = await client.query(`SELECT * FROM users WHERE id = $1`, [chat.created_by]);

        const mem = await client.query(
          `
          SELECT u.*
          FROM chat_members m
          JOIN users u ON m.user_id = u.id
          WHERE m.chat_id = $1
          `,
          [chat.id]
        );

        // 6) log
        await addLog("info", "chat-create", isNew ? "Chat created" : "Chat reused", {
          chatId: chat.id,
          userId: author_id,
          isGroup,
          directKey,
          members: allMembers.length,
          isNew,
        });

        return {
          ...chat,
          is_new: isNew,
          created_by: creator.rows[0],
          members: mem.rows,
        };
      });

      // ✅ Notification นอก txn (ส่งเฉพาะสร้างใหม่จริง)
      const chat = result as any;
      const creatorUser = chat.created_by;
      const members = chat.members as any[];

      const recipients = members.filter((m: any) => m.id !== author_id);

      if (chat.is_new) {
        await Promise.all(
          recipients.map((m: any) =>
            createNotification({
              user_id: m.id,
              type: "CHAT_CREATED",
              title: chat.is_group
                ? `คุณถูกเพิ่มในกลุ่ม "${chat.name || ""}"`
                : `เริ่มแชทใหม่กับ ${creatorUser.name}`,
              message: chat.is_group
                ? `${creatorUser.name} สร้างห้องและเพิ่มคุณเข้ากลุ่ม`
                : `${creatorUser.name} เริ่มคุยกับคุณ`,
              entity_type: "chat",
              entity_id: chat.id,
              data: {
                chat_id: chat.id,
                chat_name: chat.name,
                is_group: chat.is_group,
                actor_id: creatorUser.id,
                actor_name: creatorUser.name,
              },
            })
          )
        );
      }

      delete chat.is_new;
      return chat;
    },
    addMember: async (_:any, { chat_id, user_id }:{chat_id:string, user_id:string}, ctx:any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] addMember :", ctx, author_id);

      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        await client.query(
          `INSERT INTO chat_members (chat_id, user_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [chat_id, user_id]
        );

        await addLog('info', 'add-member', 'Add members', { chat_id,  user_id});

        return true;
      });

      return result;
    },
    sendMessage: async (
      _: any,
      {
        chat_id,
        text,
        to_user_ids,
        images,
        audio,
        audio_duration_sec,
        location,
        reply_to_id,
        client_message_id
      }: {
        chat_id: string;
        text: string;
        to_user_ids: string[];
        images?: Promise<any>[]; // Upload scalar list
        audio?: Promise<any> | null; // Upload scalar
        audio_duration_sec?: number | null;
        location?: {
          latitude: number;
          longitude: number;
          placeName?: string | null;
          googleMapsUrl?: string | null;
        } | null;
        reply_to_id?: string | null;
        client_message_id?: string | null;
      },
      ctx: any
    ) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);
      const normalizedClientMessageId =
        String(client_message_id ?? "").trim() || null;

      if (normalizedClientMessageId && normalizedClientMessageId.length > 128) {
        throw new Error("client_message_id is too long");
      }

      type SendMessagePayload = {
        id: any;
        chat_id: any;
        sender: any;
        type: string;
        text: any;
        location: any;
        created_at: string;
        to_user_ids: string[];
        images: Array<{
          id: any;
          url: any;
          file_id: any;
          mime: any;
          width: any;
          height: any;
        }>;
        audio: {
          file_id: any;
          url: any;
          mime: any;
          duration_sec: any;
        } | null;
        myReceipt: {
          deliveredAt: string;
          readAt: string | null;
          isRead: boolean;
        };
        readers: any[];
        readersCount: number;
        is_deleted: boolean;
        deleted_at: string | null;
        reply_to_id: any;
        reply_to: any;
      };

      const normalizeLocation = (input: any) => {
        if (!input) return null;
        const latitude = Number(input?.latitude);
        const longitude = Number(input?.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
        if (latitude < -90 || latitude > 90) return null;
        if (longitude < -180 || longitude > 180) return null;

        const placeName = String(input?.placeName ?? "").trim() || null;
        const rawUrl = String(input?.googleMapsUrl ?? "").trim();
        const googleMapsUrl = /^https?:\/\//i.test(rawUrl)
          ? rawUrl
          : `https://maps.google.com/?q=${latitude},${longitude}`;

        return {
          latitude,
          longitude,
          placeName,
          googleMapsUrl,
        };
      };

      const normalizedLocation = normalizeLocation(location);

      const hydrateMessageById = async (
        messageId: string
      ): Promise<SendMessagePayload | null> => {
        const baseQ = await query(
          `
          SELECT
            m.*,
            (m.deleted_at IS NOT NULL) AS is_deleted,
            row_to_json(u.*) AS sender_json,
            (
              SELECT COALESCE(json_agg(row_to_json(mi.*)), '[]'::json)
              FROM message_images mi
              WHERE mi.message_id = m.id
            ) AS images_json,
            (
              SELECT json_build_object(
                'delivered_at', r.delivered_at,
                'read_at',      r.read_at,
                'is_read',      (r.read_at IS NOT NULL)
              )
              FROM message_receipts r
              WHERE r.message_id = m.id AND r.user_id = $2
              LIMIT 1
            ) AS my_receipt_json,
            (
              SELECT COALESCE(json_agg(row_to_json(ru.*) ORDER BY r2.read_at ASC), '[]'::json)
              FROM message_receipts r2
              JOIN users ru ON ru.id = r2.user_id
              WHERE r2.message_id = m.id AND r2.read_at IS NOT NULL
            ) AS readers_json,
            (
              SELECT COUNT(*)::INT
              FROM message_receipts r3
              WHERE r3.message_id = m.id AND r3.read_at IS NOT NULL
            ) AS readers_count
          FROM messages m
          LEFT JOIN users u ON u.id = m.sender_id
          WHERE m.id = $1
          LIMIT 1
          `,
          [messageId, author_id]
        );

        const r = baseQ.rows[0];
        if (!r) return null;

        let replyTo: any = null;
        if (r.reply_to_id) {
          const replyQ = await query(
            `
            SELECT
              m.*,
              row_to_json(u.*) AS sender_json,
              (
                SELECT COALESCE(json_agg(row_to_json(mi.*)), '[]'::json)
                FROM message_images mi
                WHERE mi.message_id = m.id
              ) AS images_json
            FROM messages m
            LEFT JOIN users u ON u.id = m.sender_id
            WHERE m.id = $1
            LIMIT 1
            `,
            [r.reply_to_id]
          );
          const rp = replyQ.rows[0];
          if (rp) {
            const replyAudioFileId = rp.audio_file_id ?? null;
            const replyAudio = replyAudioFileId
              ? {
                  file_id: replyAudioFileId,
                  url: buildFileUrlById(Number(replyAudioFileId)),
                  mime: rp.audio_mime ?? null,
                  duration_sec:
                    typeof rp.audio_duration_sec === "number"
                      ? rp.audio_duration_sec
                      : null,
                }
              : null;

            const replyType =
              String(rp.message_type || "").trim() ||
              (rp.location_json
                ? "LOCATION"
                : replyAudioFileId
                ? "AUDIO"
                : rp.text
                ? "TEXT"
                : "TEXT");

            replyTo = {
              id: rp.id,
              type: replyType,
              text: rp.text,
              location: rp.location_json ?? null,
              audio: replyAudio,
              sender: rp.sender_json,
              images: Array.isArray(rp.images_json)
                ? rp.images_json.map((i: any) => ({
                    id: i.id,
                    url: i.url,
                    file_id: i.file_id ?? null,
                    mime: i.mime ?? null,
                    width: i.width ?? null,
                    height: i.height ?? null,
                  }))
                : [],
            };
          }
        }

        const createdISO = new Date(r.created_at).toISOString();
        const mr = r.my_receipt_json || null;

        const audioFileId = r.audio_file_id ?? null;
        const audioPayload = audioFileId
          ? {
              file_id: audioFileId,
              url: buildFileUrlById(Number(audioFileId)),
              mime: r.audio_mime ?? null,
              duration_sec:
                typeof r.audio_duration_sec === "number"
                  ? r.audio_duration_sec
                  : null,
            }
          : null;

        const inferredType =
          String(r.message_type || "").trim() ||
          (r.location_json ? "LOCATION" : audioFileId ? "AUDIO" : "TEXT");

        return {
          id: r.id,
          chat_id: r.chat_id,
          sender: r.sender_json,
          type: inferredType,
          text: r.is_deleted ? "" : r.text || "",
          location: r.location_json ?? null,
          created_at: createdISO,
          to_user_ids: [] as string[],
          images: Array.isArray(r.images_json)
            ? r.images_json.map((img: any) => ({
                id: img.id,
                url: img.url,
                file_id: img.file_id ?? null,
                mime: img.mime ?? null,
                width: img.width ?? null,
                height: img.height ?? null,
              }))
            : [],

          audio: audioPayload,
          myReceipt: {
            deliveredAt: mr?.delivered_at
              ? new Date(mr.delivered_at).toISOString()
              : createdISO,
            readAt: mr?.read_at ? new Date(mr.read_at).toISOString() : null,
            isRead: !!mr?.is_read,
          },
          readers: Array.isArray(r.readers_json) ? r.readers_json : [],
          readersCount: Number(r.readers_count) || 0,
          is_deleted: !!r.is_deleted,
          deleted_at: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,
          reply_to_id: r.reply_to_id || null,
          reply_to: replyTo,
        };
      };

      console.info("[sendMessage] =", author_id, chat_id, to_user_ids);

      if (normalizedClientMessageId) {
        const existingRes = await query(
          `
          SELECT id
          FROM messages
          WHERE chat_id = $1
            AND sender_id = $2
            AND client_message_id = $3
          LIMIT 1
          `,
          [chat_id, author_id, normalizedClientMessageId]
        );

        const existingId = existingRes.rows[0]?.id;
        if (existingId) {
          const existingMessage = await hydrateMessageById(String(existingId));
          if (existingMessage) return existingMessage;
        }
      }

      // กรอง to_user_ids ให้ไม่ซ้ำ + ไม่รวมตัวเอง
      const cleanTo = Array.from(
        new Set(
          (to_user_ids || [])
            .filter(Boolean)
            .filter((id) => id !== author_id)
        )
      );

      // ===== Step 1: Pre-upload images (no transaction) =====
      let uploadedFiles: {
        id: number;
        relpath: string;
        mimetype: string | null;
        filename: string;
      }[] = [];

      let uploadedAudio:
        | {
            id: number;
            relpath: string;
            mimetype: string | null;
            filename: string;
          }
        | null = null;

      if (images && images.length > 0) {
        uploadedFiles = await Promise.all(
          images.map(async (imgPromise) => {
            const upload = await imgPromise; // Upload object (Upload scalar)

            const uploadName = upload?.filename || upload?.fileName || "image";
            const renameTo = `chat_${chat_id}_${Date.now()}_${uploadName}`;
            const fileRow = await persistUploadStream(upload, renameTo);

            return {
              id: fileRow.id,
              relpath: fileRow.relpath,
              mimetype: fileRow.mimetype,
              filename: fileRow.filename,
            };
          })
        );
      }

      if (audio) {
        const upload = await audio;
        const rawMime = String(upload?.mimetype || upload?.mimeType || "");
        const rawName = String(upload?.filename || upload?.fileName || "");

        const cleanMime = (m: string) => (m || "").split(";")[0].trim().toLowerCase();
        const ext = path.extname(rawName).toLowerCase();

        const guessAudioMimeFromExt = (e: string) => {
          if (e === ".webm") return "audio/webm";
          if (e === ".ogg" || e === ".oga") return "audio/ogg";
          if (e === ".mp3") return "audio/mpeg";
          if (e === ".wav") return "audio/wav";
          if (e === ".m4a" || e === ".mp4") return "audio/mp4";
          if (e === ".aac") return "audio/aac";
          return "";
        };

        const normalizeRecordedAudioMime = (m: string) => {
          const base = cleanMime(m);
          if (!base) return "";
          if (base === "video/webm") return "audio/webm";
          if (base === "video/mp4") return "audio/mp4";
          if (base === "audio/x-m4a") return "audio/mp4";
          return base;
        };

        const base = cleanMime(rawMime);
        const normalized = normalizeRecordedAudioMime(rawMime) || guessAudioMimeFromExt(ext);

        // Strict but browser-compatible:
        // - Accept audio/*
        // - Accept common MediaRecorder containers sometimes labeled as video/*
        // - Accept octet-stream only when filename looks like audio
        const isAllowedAudio = normalized.startsWith("audio/");
        const isOctetStream = base === "application/octet-stream";

        if (base) {
          if (isOctetStream) {
            if (!isAllowedAudio) throw new Error("Invalid audio mimetype");
          } else if (!isAllowedAudio) {
            throw new Error("Invalid audio mimetype");
          }
        } else {
          // No mimetype given: only accept if we can infer from filename.
          if (!isAllowedAudio) throw new Error("Invalid audio mimetype");
        }

        // Ensure persisted upload has a normalized audio mimetype for correct serving/playback.
        if (isAllowedAudio) {
          (upload as any).mimetype = normalized;
        }

        const uploadName = upload?.filename || upload?.fileName || "voice";
        const renameTo = `voice_${chat_id}_${Date.now()}_${uploadName}`;
        const fileRow = await persistUploadStream(upload, renameTo);
        uploadedAudio = {
          id: fileRow.id,
          relpath: fileRow.relpath,
          mimetype: fileRow.mimetype,
          filename: fileRow.filename,
        };
      }

      const normalizedDurationSecRaw =
        typeof audio_duration_sec === "number" ? audio_duration_sec : null;
      const normalizedDurationSec =
        normalizedDurationSecRaw && Number.isFinite(normalizedDurationSecRaw)
          ? Math.max(1, Math.min(60 * 15, Math.round(normalizedDurationSecRaw)))
          : null;

      const messageType = normalizedLocation
        ? "LOCATION"
        : uploadedAudio
        ? "AUDIO"
        : uploadedFiles.length
        ? "IMAGE"
        : "TEXT";

      // ===== Step 2: Use transaction for DB operations =====
      const { revisionId, result } = await runInTransaction<{
        inserted: boolean;
        existingId: string | null;
        fullMessage: SendMessagePayload | null;
      }>(author_id, async (client, ctx) => {
        // 1) Insert message (เพิ่ม reply_to_id เข้าไป)
        const msgRes = await client.query(
          `
          INSERT INTO messages (
            chat_id,
            sender_id,
            text,
            reply_to_id,
            client_message_id,
            audio_file_id,
            audio_mime,
            audio_duration_sec,
            message_type,
            location_json
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (chat_id, sender_id, client_message_id) DO NOTHING
          RETURNING *
          `,
          [
            chat_id,
            author_id,
            text,
            reply_to_id || null,
            normalizedClientMessageId,
            uploadedAudio?.id ?? null,
            uploadedAudio?.mimetype ?? null,
            normalizedDurationSec,
            messageType,
            normalizedLocation,
          ]
        );
        const msg = msgRes.rows[0];

        if (!msg) {
          const existingRes = await client.query(
            `
            SELECT id
            FROM messages
            WHERE chat_id = $1
              AND sender_id = $2
              AND client_message_id = $3
            ORDER BY created_at DESC
            LIMIT 1
            `,
            [chat_id, author_id, normalizedClientMessageId]
          );

          const existingId = existingRes.rows[0]?.id;
          if (!existingId) {
            throw new Error("Cannot resolve duplicated message");
          }

          return { inserted: false, existingId: String(existingId), fullMessage: null };
        }

        // 2) Insert message_images
        if (uploadedFiles.length > 0) {
          for (const f of uploadedFiles) {
            await client.query(
              `
              INSERT INTO message_images (message_id, file_id, url, mime)
              VALUES ($1,$2,$3,$4)
              `,
              [
                msg.id,
                f.id,
                `/${f.relpath}`,
                f.mimetype,
              ]
            );
          }
        }

        // 3) Insert receipts for recipients
        if (cleanTo.length > 0) {
          await client.query(
            `
            INSERT INTO message_receipts (message_id, user_id, delivered_at, read_at)
            SELECT $1, uid, NOW(), NULL
            FROM UNNEST($2::uuid[]) AS u(uid)
            ON CONFLICT (message_id, user_id) DO NOTHING
            `,
            [msg.id, cleanTo]
          );
        }

        // 4) sender receipt
        await client.query(
          `
          INSERT INTO message_receipts (message_id, user_id, delivered_at, read_at)
          VALUES ($1,$2,NOW(),NOW())
          ON CONFLICT (message_id, user_id) DO NOTHING
          `,
          [msg.id, author_id]
        );

        // 5) Hydrate images (ให้เป็น [] แน่นอน ไม่ใช่ null)
        const imgRows = (
          await client.query(
            `
            SELECT id, file_id, url, mime, width, height
            FROM message_images
            WHERE message_id=$1
            `,
            [msg.id]
          )
        ).rows;

        const imagesSafe = Array.isArray(imgRows)
          ? imgRows.map((img: any) => ({
              id: img.id,
              url: img.url,
              file_id: img.file_id ?? null,
              mime: img.mime ?? null,
              width: img.width ?? null,
              height: img.height ?? null,
            }))
          : [];

        const audioSafe = msg.audio_file_id
          ? {
              file_id: msg.audio_file_id,
              url: buildFileUrlById(Number(msg.audio_file_id)),
              mime: msg.audio_mime ?? null,
              duration_sec:
                typeof msg.audio_duration_sec === "number"
                  ? msg.audio_duration_sec
                  : null,
            }
          : null;

        // 5.5) Hydrate reply_to (match Query.messages shape for realtime payload)
        let replyTo: any = null;
        if (msg.reply_to_id) {
          const replyQ = await client.query(
            `
            SELECT
              m.*,
              row_to_json(u.*) AS sender_json,
              (
                SELECT COALESCE(json_agg(row_to_json(mi.*)), '[]'::json)
                FROM message_images mi
                WHERE mi.message_id = m.id
              ) AS images_json
            FROM messages m
            LEFT JOIN users u ON u.id = m.sender_id
            WHERE m.id = $1
            LIMIT 1
            `,
            [msg.reply_to_id]
          );

          const rp = replyQ.rows[0];
          if (rp) {
            const replyAudioFileId = rp.audio_file_id ?? null;
            const replyAudio = replyAudioFileId
              ? {
                  file_id: replyAudioFileId,
                  url: buildFileUrlById(Number(replyAudioFileId)),
                  mime: rp.audio_mime ?? null,
                  duration_sec:
                    typeof rp.audio_duration_sec === "number"
                      ? rp.audio_duration_sec
                      : null,
                }
              : null;

            const replyType =
              String(rp.message_type || "").trim() ||
              (rp.location_json
                ? "LOCATION"
                : replyAudioFileId
                ? "AUDIO"
                : rp.text
                ? "TEXT"
                : "TEXT");

            replyTo = {
              id: rp.id,
              type: replyType,
              text: rp.text,
              location: rp.location_json ?? null,
              audio: replyAudio,
              sender: rp.sender_json ?? null,
              images: Array.isArray(rp.images_json)
                ? rp.images_json.map((i: any) => ({
                    id: i.id,
                    url: i.url,
                    file_id: i.file_id ?? null,
                    mime: i.mime ?? null,
                    width: i.width ?? null,
                    height: i.height ?? null,
                  }))
                : [],
            };
          }
        }

        // 6) Hydrate sender + readers + receipt data (match Query.messages JSON shape)
        const senderQ = await client.query(
          `SELECT row_to_json(u.*) AS sender_json FROM users u WHERE id=$1 LIMIT 1`,
          [author_id]
        );

        const readersQ = await client.query(
          `
          SELECT row_to_json(u.*) AS user_json
          FROM message_receipts r
          JOIN users u ON u.id=r.user_id
          WHERE r.message_id=$1 AND r.read_at IS NOT NULL
          `,
          [msg.id]
        );

        const cntQ = await client.query(
          `
          SELECT COUNT(*)::int AS c
          FROM message_receipts
          WHERE message_id=$1 AND read_at IS NOT NULL
          `,
          [msg.id]
        );

        const myRecQ = await client.query(
          `
          SELECT delivered_at, read_at, (read_at IS NOT NULL) AS is_read
          FROM message_receipts
          WHERE message_id=$1 AND user_id=$2
          `,
          [msg.id, author_id]
        );
        const mr = myRecQ.rows[0] || {};

        const createdISO = new Date(msg.created_at).toISOString();

        const myReceipt = {
          deliveredAt: mr?.delivered_at
            ? new Date(mr.delivered_at).toISOString()
            : createdISO,
          readAt: mr?.read_at ? new Date(mr.read_at).toISOString() : null,
          isRead: !!mr?.is_read,
        };

        return {
          inserted: true,
          existingId: null,
          fullMessage: {
            id: msg.id,
            chat_id: msg.chat_id,
            sender: senderQ.rows[0]?.sender_json ?? null,
            type: String(msg.message_type || "").trim() || messageType,
            text: msg.text || "",
            location: msg.location_json ?? normalizedLocation,
            created_at: createdISO,
            to_user_ids: cleanTo,

            images: imagesSafe,            // ✅ ไม่เป็น null แน่นอน

            audio: audioSafe,

            myReceipt,
            readers: readersQ.rows.map((r: any) => r.user_json).filter(Boolean),
            readersCount: Number(cntQ.rows[0]?.c || 0),
            is_deleted: false,
            deleted_at: null,

            reply_to_id: msg.reply_to_id ?? null,  // ✅ payload มี reply_to_id
            reply_to: replyTo,
          },
        };
      });

      let fullMessage = result.fullMessage ?? null;
      const wasInserted = !!result.inserted;

      if (!fullMessage && result.existingId) {
        fullMessage = await hydrateMessageById(result.existingId);
      }

      if (!fullMessage) {
        throw new Error("Cannot load message payload");
      }

      if (!wasInserted) {
        return fullMessage;
      }

      // ===== Step 3: publish realtime =====
      await pubsub.publish(topicChat(fullMessage.chat_id), {
        messageAdded: fullMessage, // ✅ รูปแบบเดียวกับที่ return ให้ client
      });

      const targetUserIds = [...cleanTo, author_id]; // คนรับทุกคน + คนส่งเอง (จะใช้เช็คว่า tab ไหนเปิดอยู่)
      await pubsub.publish(INCOMING_MESSAGE, {
        incomingMessage: fullMessage,
        targetUserIds,
      });

      // ===== Step 4: push notification (Android FCM) =====
      // Do not block the mutation on push failures.
      void (async () => {
        try {
          const projectId = process.env.FCM_PROJECT_ID;
          const clientEmail = process.env.FCM_CLIENT_EMAIL;
          const privateKey = process.env.FCM_PRIVATE_KEY;

          if (!projectId || !clientEmail || !privateKey) {
            if (isDev) console.warn("[FCM] missing env, skip push");
            return;
          }

          // recipients are cleanTo (sender removed), filtered by per-chat notification setting
          const pushEnabledRows = cleanTo.length
            ? (
                await query(
                  `
                  SELECT cm.user_id
                  FROM chat_members cm
                  JOIN users u ON u.id = cm.user_id
                  WHERE cm.chat_id = $1
                    AND cm.user_id = ANY($2::uuid[])
                    AND COALESCE(cm.notifications_enabled, true) = true
                    AND COALESCE(u.notifications_enabled, true) = true
                  `,
                  [chat_id, cleanTo]
                ).catch(() => ({ rows: [] as any[] }))
              ).rows
            : [];

          const pushEnabledRecipients = new Set(
            pushEnabledRows.map((r: any) => String(r.user_id))
          );

          for (const recipientUserId of cleanTo) {
            // If sender somehow appears, skip
            if (String(recipientUserId) === String(author_id)) continue;
            if (!pushEnabledRecipients.has(String(recipientUserId))) continue;

            // total unread for this user (badge)
            const { rows } = await query(
              `SELECT COALESCE(SUM(unread_count), 0)::BIGINT AS c FROM chat_unread_counts WHERE user_id=$1`,
              [recipientUserId]
            ).catch(() => ({ rows: [] as any[] }));
            const unreadTotal = Number(rows[0]?.c || 0);

            const tokens = await listActiveFcmTokens(recipientUserId);
            if (!tokens.length) continue;

            const senderName = String(fullMessage?.sender?.name || "").trim() || "New message";
            const previewText = String(fullMessage?.text || "").trim();
            const hasImages = Array.isArray((fullMessage as any)?.images) && (fullMessage as any).images.length > 0;
            const hasAudio = !!(fullMessage as any)?.audio;
            const preview = previewText || (hasAudio ? "🎤 Voice message" : hasImages ? "ส่งรูปภาพมา" : "ส่งข้อความมา");
            const deepLink = `jachoei://chat/${fullMessage.chat_id}`;
            const webUrl = `${process.env.NEXT_PUBLIC_WEB_URL || process.env.NEXT_PUBLIC_WEB_BASE || "https://jachoei.com"}/chat/${fullMessage.chat_id}`;
            const timestamp = String(fullMessage?.created_at || new Date().toISOString());

            for (const token of tokens) {
              const resp = await sendFcmChatPush(
                {
                  projectId,
                  clientEmail,
                  privateKey,
                },
                {
                  token,
                  notification: { title: senderName, body: preview },
                  data: {
                    type: "chat_message",
                    conversationId: String(fullMessage.chat_id),
                    messageId: String(fullMessage.id),
                    senderId: String(author_id),
                    senderName,
                    preview,
                    unreadCount: unreadTotal,
                    deepLink,
                    webUrl,
                    timestamp,
                  },
                  android: {
                    channelId: "chat_messages",
                    collapseKey: `chat_${fullMessage.chat_id}`,
                    tag: String(fullMessage.chat_id),
                  },
                }
              );

              if (!resp.ok) {
                // Invalid / unregistered token -> deactivate
                const errCode = (resp as any)?.body?.error?.status;
                const msg = (resp as any)?.body?.error?.message;
                const isInvalid =
                  errCode === "NOT_FOUND" ||
                  /UNREGISTERED|registration token is not a valid FCM registration token/i.test(String(msg || ""));
                if (isInvalid) {
                  await deactivateDevicePushToken(recipientUserId, token).catch(() => {});
                }
              }
            }
          }
        } catch (e) {
          if (isDev) console.warn("[FCM] push send failed", e);
        }
      })();

      console.info("[sendMessage][fullMessage] :", fullMessage);

      return fullMessage;
    },
    registerPushToken: async (_: any, { input }: any, ctx: any) => {
      const { author_id } = requireAuth(ctx);
      const platform = String(input?.platform || "").trim().toLowerCase();
      if (platform !== "android") throw new Error("Only android is supported");

      return upsertDevicePushToken(String(author_id), {
        platform: "android",
        fcmToken: String(input?.fcmToken || ""),
        deviceId: input?.deviceId ?? null,
        appVersion: input?.appVersion ?? null,
        locale: input?.locale ?? null,
      });
    },

    unregisterPushToken: async (_: any, { fcmToken }: any, ctx: any) => {
      const { author_id } = requireAuth(ctx);
      return deactivateDevicePushToken(String(author_id), String(fcmToken || ""));
    },
    upsertUser: async (_: any, { id, data }: { id?: string, data: any }, ctx:any) => {
      // gate: platform admin จัดการได้ทุกร้าน · Administrator เฉพาะร้านตัวเอง
      const { platform, tenantId } = await requireUserAdmin(ctx);
      const author_id = String(requireAuth(ctx).author_id);

      console.log("[Mutation] upsertUser :", ctx, author_id);

      // 2️⃣ ทำความสะอาดข้อมูล
      const name = (data.name ?? '').trim();
      const avatar = data.avatar ?? null;
      const phone = data.phone ?? null;
      const email = data.email ? String(data.email).trim().toLowerCase() : null;
      const passwordHash = data.passwordHash ?? null;

      // ✅ NEW: Handle role_id (preferred) or fallback to role text
      let roleId = data.role_id || null;
      const roleText = data.role ? String(data.role).trim() : null;

      // If role_id not provided but role text is, try to find role_id by name
      if (!roleId && roleText) {
        try {
          const { rows } = await query(
            `SELECT id FROM roles WHERE name = $1 LIMIT 1`,
            [roleText]
          );
          if (rows[0]) {
            roleId = rows[0].id;
          }
        } catch (err) {
          console.error('[upsertUser] Error looking up role by name:', err);
        }
      }

      // ✅ ใช้ transaction wrapper เพื่อ ensure COMMIT/ROLLBACK และ SET LOCAL app.editor_id
      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        let resultUser = null;

        if (id) {
          // 🧩 UPDATE: อัปเดต password_hash เฉพาะเมื่อส่งมา
          // Prefer role_id, but keep role for backward compatibility (triggers will sync)
          const updateFields: string[] = [];
          const updateValues: any[] = [];
          let paramIndex = 1;

          updateFields.push(`name = $${paramIndex}`);
          updateValues.push(name);
          paramIndex++;

          updateFields.push(`avatar = $${paramIndex}`);
          updateValues.push(avatar);
          paramIndex++;

          updateFields.push(`phone = $${paramIndex}`);
          updateValues.push(phone);
          paramIndex++;

          // ✅ Use role_id if available
          if (roleId) {
            updateFields.push(`role_id = $${paramIndex}`);
            updateValues.push(roleId);
            paramIndex++;
          } else if (roleText) {
            // Fallback to role text (triggers will sync role_id)
            updateFields.push(`role = $${paramIndex}`);
            updateValues.push(roleText);
            paramIndex++;
          }

          if (passwordHash) {
            updateFields.push(`password_hash = $${paramIndex}`);
            updateValues.push(passwordHash);
            paramIndex++;
          }

          updateValues.push(id); // WHERE id = $n
          let whereClause = `id = $${paramIndex}`;
          // non-platform แก้ได้เฉพาะ user ในร้านตัวเอง (กันแก้ข้ามร้าน)
          if (!platform) {
            updateValues.push(tenantId);
            whereClause += ` AND tenant_id = $${paramIndex + 1}`;
          }

          const { rows } = await client.query(
            `UPDATE users SET ${updateFields.join(', ')} WHERE ${whereClause} RETURNING *`,
            updateValues
          );

          resultUser = rows[0] || null;

          if (resultUser) {
            await addLog(
              "info",
              "user-update",
              "User profile updated",
              { userId: resultUser.id, editorId: author_id, roleId }
            );
          }
        } else {
          // 🧩 INSERT: ต้องมี email
          if (!email) throw new GraphQLError("email is required");

          // user ใหม่สังกัดร้านของผู้สร้าง (platform admin ระบุ tenant อื่นได้)
          const newTenantId = platform && data.tenant_id ? String(data.tenant_id) : tenantId;
          // เกิน quota staff ของแพ็กเกจร้าน → ปฏิเสธ (platform admin ไม่ถูกจำกัด)
          if (!platform) await enforceUserQuota(newTenantId);

          // Use role_id if available, otherwise use role text
          if (roleId) {
            const { rows } = await client.query(
              `INSERT INTO users (name, avatar, phone, email, role_id, password_hash, tenant_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
              [name, avatar, phone, email, roleId, passwordHash, newTenantId]
            );
            resultUser = rows[0] || null;
          } else {
            // Fallback to role text (triggers will sync role_id)
            const role = roleText || 'Subscriber';
            const { rows } = await client.query(
              `INSERT INTO users (name, avatar, phone, email, role, password_hash, tenant_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
              [name, avatar, phone, email, role, passwordHash, newTenantId]
            );
            resultUser = rows[0] || null;
          }

          if (resultUser) {
            await addLog(
              "info",
              "upsert-user", 
              "Upsert User",
              { userId: resultUser.id, roleId }
            );
          }
        }

        return resultUser;
      });

      return result;
    },
    uploadAvatar: async (_: any, { user_id, file }: { user_id: string, file: Promise<GraphQLUploadFile> }, ctx: any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const { platform, tenantId } = await requireUserAdmin(ctx);
      const author_id = String(auth.author_id);

      console.log("[Mutation] uploadAvatar :", author_id);

      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        const f = await file; // { filename, mimetype, encoding, createReadStream }

        // สร้างชื่อใหม่ เช่น avatar-<user_id>.ext
        const ext = path.extname(f.filename || "");
        const renameTo = `avatar-${user_id}${ext || ""}`;

        const row = await persistUploadStream(f, renameTo); // 👈 ใช้ stream

        const avatarUrl = buildFileUrlById(row.id);

        const updateRes = platform
          ? await client.query(`UPDATE users SET avatar=$1 WHERE id=$2`, [avatarUrl, user_id])
          : await client.query(`UPDATE users SET avatar=$1 WHERE id=$2 AND tenant_id=$3`, [avatarUrl, user_id, tenantId]);
        if (updateRes.rowCount !== 1) {
          throw new GraphQLError("user not found in current tenant", {
            extensions: { code: "NOT_FOUND" },
          });
        }

        await addLog("info", "upload-avatar", "Upload avatar", {
          userId: user_id,
          fileId: row.id,
        });

        return avatarUrl;
      });

      return result;
    },
    deleteUser: async (_: any, { id }: { id: string }, ctx: any) => {
      // gate: platform admin ลบได้ทุกร้าน · Administrator เฉพาะร้านตัวเอง
      const { platform, tenantId } = await requireUserAdmin(ctx);
      const author_id = String(requireAuth(ctx).author_id);

      // ห้ามลบบัญชีตัวเอง — ไม่งั้น Administrator คนสุดท้ายของร้าน (หรือ platform admin เอง)
      // ลบตัวเองแล้วล็อกทุกคนออกจากร้าน/แพลตฟอร์มไปเลย ไม่มีใครกู้คืนได้ผ่าน UI
      if (String(id) === author_id) {
        throw new GraphQLError("ลบบัญชีของตัวเองไม่ได้", {
          extensions: { code: "BAD_USER_INPUT", http: { status: 400 } },
        });
      }

      console.log("[Mutation] deleteUser:", id, author_id, { platform });

      // แชท OPEN/PENDING ที่ยัง assign อยู่กับ user นี้ต้องโอนก่อนเสมอ (ห้ามเหลือแชทไม่มี staff)
      const target = platform
        ? await query<{ tenant_id: string }>(`SELECT tenant_id FROM users WHERE id = $1`, [id])
        : await query<{ tenant_id: string }>(`SELECT tenant_id FROM users WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
      if (target.rows[0]?.tenant_id) {
        await reassignStaffConversations(target.rows[0].tenant_id, id);
      }

      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        const res = platform
          ? await client.query(`DELETE FROM users WHERE id=$1`, [id])
          : await client.query(`DELETE FROM users WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
        const ok = res.rowCount === 1;

        if (ok) {
          await addLog('info', 'user-delete', 'User deleted', {
            deletedId: id,
            author_id,
          });
        }

        return ok;
      });

      return result;
    },
    deleteUsers: async (_: any, { ids }: { ids: string[] }, ctx: any) => {
      // gate: platform admin ลบได้ทุกร้าน · Administrator เฉพาะร้านตัวเอง
      const { platform, tenantId } = await requireUserAdmin(ctx);
      const author_id = String(requireAuth(ctx).author_id);

      console.log("[Mutation] deleteUsers :", author_id, { platform });

      if (!ids || ids.length === 0) return false;

      const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      // กรองบัญชีตัวเองออกเสมอ (เหมือน deleteUser) แทนที่จะปฏิเสธทั้ง batch — เลือกหลายคนรวมตัวเอง
      // มาด้วยได้ แค่ตัวเองไม่โดนลบ ที่เหลือยังลบตามปกติ
      const uuidIds = ids.filter((i) => uuidPattern.test(i) && String(i) !== author_id);

      if (uuidIds.length === 0) return false;

      // เหมือน deleteUser — โอนแชทค้างของแต่ละคนก่อนลบเสมอ
      const targets = platform
        ? await query<{ id: string; tenant_id: string }>(
            `SELECT id, tenant_id FROM users WHERE id = ANY($1::uuid[])`, [uuidIds]
          )
        : await query<{ id: string; tenant_id: string }>(
            `SELECT id, tenant_id FROM users WHERE id = ANY($1::uuid[]) AND tenant_id = $2`, [uuidIds, tenantId]
          );
      for (const t of targets.rows) {
        if (t.tenant_id) await reassignStaffConversations(t.tenant_id, t.id);
      }

      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        const res = platform
          ? await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [uuidIds])
          : await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[]) AND tenant_id=$2`, [uuidIds, tenantId]);

        const affected = res.rowCount ?? 0; // กัน null ที่นี่

        if (affected > 0) {
          await addLog(
            "info",
            "user-delete",
            `Deleted ${affected} user(s)`,
            { userId: author_id, deletedIds: uuidIds }
          );
        }

        return affected > 0;
      });

      return result;
    },
    updateMyProfile: async (_:any, { data }:{ data: { name?: string, avatar?: string, phone?: string }}, ctx:any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] updateMyProfile :", author_id, data);

      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        const { rows } = await client.query(
          `UPDATE users SET 
              name   = COALESCE($1, name),
              avatar = COALESCE($2, avatar),
              phone  = COALESCE($3, phone),
              updated_at = NOW()
          WHERE id = $4
          RETURNING *`,
          [data.name ?? null, data.avatar ?? null, data.phone ?? null, author_id]
        );

        return rows[0];
      });

      // ✅ log event หลัง transaction สำเร็จ
      await addLog(
        'info',
        'user-update-profile',
        'User updated profile',
        { userId: author_id, changed: Object.keys(data) }
      );

      return result;
    },
    renameChat: async (_:any, { chat_id, name }:{chat_id:string, name?:string}, ctx:any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx); // ✅ ตรวจสิทธิ์
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log('[Mutation] renameChat :', chat_id, name, author_id);

      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        await client.query(
          `UPDATE chats SET name=$1 WHERE id=$2`,
          [name || null, chat_id]
        );

        await addLog('info', 'chat-rename', 'Chat renamed', {
          chatId: chat_id,
          userId: author_id,
          newName: name || null,
        });

        return true;
      });

      return result;
    },
    deleteChat: async (_:any, { chat_id }:{chat_id:string}, ctx:any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        const { rows: [chat] } = await client.query(
          `SELECT is_undeletable FROM chats WHERE id = $1`, [chat_id]
        );
        if (chat?.is_undeletable) {
          throw new Error("ไม่สามารถลบ chat นี้ได้");
        }

        await client.query(`DELETE FROM chats WHERE id = $1`, [chat_id]);

        await addLog(
          "info",
          "chat-delete",
          `User ${author_id} deleted chat ${chat_id}`,
          { author_id, chatId: chat_id }
        );

        return true;
      });

      return result;
    },
    updateMyChatSettings: async (
      _: any,
      {
        chat_id,
        is_muted,
        notifications_enabled,
      }: {
        chat_id: string;
        is_muted?: boolean | null;
        notifications_enabled?: boolean | null;
      },
      ctx: any
    ) => {
      const { author_id } = requireAuth(ctx);

      const { revisionId, result } = await runInTransaction(
        String(author_id),
        async (client, txCtx) => {
          const { rows } = await client.query(
            `
            UPDATE chat_members
            SET
              is_muted = COALESCE($3::boolean, is_muted),
              notifications_enabled = COALESCE($4::boolean, notifications_enabled)
            WHERE chat_id = $1 AND user_id = $2
            RETURNING
              COALESCE(is_muted, false) AS is_muted,
              COALESCE(notifications_enabled, true) AS notifications_enabled
            `,
            [chat_id, author_id, is_muted ?? null, notifications_enabled ?? null]
          );

          if (!rows[0]) {
            throw new Error("Chat membership not found");
          }

          await addLog("info", "chat-settings", "User updated chat settings", {
            userId: String(author_id),
            chatId: chat_id,
            is_muted: rows[0].is_muted,
            notifications_enabled: rows[0].notifications_enabled,
          });

          return {
            is_muted: !!rows[0].is_muted,
            notifications_enabled: !!rows[0].notifications_enabled,
          };
        }
      );

      return result;
    },
    markMessageRead: async (_:any, { message_id }:{ message_id:string }, ctx:any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] markMessageRead :", message_id, "by", author_id);

      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        await client.query(
          `UPDATE message_receipts
            SET read_at = COALESCE(read_at, NOW())
          WHERE message_id = $1 AND user_id = $2`,
          [message_id, author_id]
        );

        await addLog(
          "info",                  // ระดับ log
          "message-read",          // หมวดหมู่
          "User marked message as read", // ข้อความหลัก
          { userId: author_id, messageId: message_id } // meta เพิ่มเติม
        );

        return true;
      });

      return result;
    },
    markChatReadUpTo: async (_:any, { chat_id, cursor }:{ chat_id:string, cursor:string }, ctx:any) => {
      // 1️⃣ ตรวจสอบสิทธิ์ผู้ใช้
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log('[Mutation] markChatReadUpTo :', author_id, chat_id, cursor);

      // 2️⃣ ทำงานใน transaction
      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        await client.query(
          `
          UPDATE message_receipts r
            SET read_at = COALESCE(r.read_at, NOW())
            FROM messages m
          WHERE r.message_id = m.id
            AND r.user_id = $1
            AND m.chat_id = $2
            AND m.created_at <= ($3::timestamptz + interval '1 millisecond')
          `,
          [author_id, chat_id, cursor]
        );

        // 3️⃣ log ลงระบบ
        await addLog(
          'info',
          'chat-read',
          'User marked chat messages as read',
          { userId: author_id, chatId: chat_id, cursor }
        );

        return true;
      });

      return result;
    },
    deleteMessage: async (_:any, { message_id }:{ message_id:string }, ctx:any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);
      console.log("[Mutation] deleteMessage :", ctx, author_id);

      const { revisionId, result } =  await runInTransaction(author_id, async (client, ctx) => {
        const { rows } = await client.query(
          `SELECT id, chat_id, sender_id, deleted_at FROM messages WHERE id=$1 LIMIT 1`,
          [message_id]
        );
        const msg = rows[0];
        if (!msg) return false;

        // 2️⃣ ตรวจสิทธิ์ (optional)
        // const canDelete = (msg.sender_id === author_id) || ctx?.admin?.role === 'Administrator';
        // if (!canDelete) throw new GraphQLError('FORBIDDEN', { extensions: { code: 'FORBIDDEN' } });

        // 3️⃣ ลบ (soft delete)
        const { rowCount } = await client.query(
          `UPDATE messages SET deleted_at = NOW() WHERE id=$1 AND deleted_at IS NULL`,
          [message_id]
        );

        if (!rowCount) {
          console.warn(`[deleteMessage] message already deleted: ${message_id}`);
          return false;
        }

        // 4️⃣ Publish event สำหรับ subscribers
        await pubsub.publish(topicChat(msg.chat_id), { messageDeleted: message_id });

        // 5️⃣ บันทึก log
        await addLog(
          'info',
          'message-delete',
          'User deleted message',
          { userId: author_id, messageId: message_id, chatId: msg.chat_id }
        );

        return true;
      });

      console.log("revisionId =", revisionId, "result =", result);
      return result;
    },
    deleteFile: async (_: any, { id }: { id: string }, ctx: any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] deleteFile :", { id, author_id });

      const { revisionId, result } =  await runInTransaction(author_id, async (client, ctx) => {
        const res = await client.query(`DELETE FROM files WHERE id = $1`, [id]);

        if (res.rowCount === 1) {
          await addLog(
            "info",
            "file-delete",
            "User deleted a file",
            { author_id, fileId: id }
          );
          return true;
        } else {
          return false;
        }
      });

      console.log("revisionId =", revisionId, "result =", result);

      return result;
    },
    deleteFiles: async (_: any, { ids }: { ids: string[] }, ctx: any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      console.log("[Mutation] deleteFiles :", ids, "by", author_id);

      if (!ids?.length) return false;

      const intIds = ids
        .map((n) => parseInt(String(n), 10))
        .filter((n) => !isNaN(n));

      if (!intIds.length) return false;

      const { revisionId, result } =  await runInTransaction(author_id, async (client, ctx) => {
        const res = await client.query(
          `DELETE FROM files WHERE id = ANY($1::int[])`,
          [intIds]
        );

        // rowCount: number | null → ใช้ ?? 0 ป้องกัน null
        const deleted = (res.rowCount ?? 0) > 0;

        if (deleted) {
          await addLog(
            "info",
            "file-delete",
            "User deleted files",
            { author_id, ids: intIds }
          );
        }

        return deleted;
      });

      console.log("revisionId =", revisionId, "result =", result);

      return result;
    },
    renameFile: async (_: any, { id, name }: { id: string, name: string }, ctx: any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx); // ✅ ตรวจสิทธิ์ก่อน
      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);
      console.log("[Mutation] renameFile by:", author_id);

      // ✅ ใช้ transaction helper
      const { revisionId, result } =  await runInTransaction(author_id, async (client, ctx) => {
        const res = await client.query(
          `UPDATE files 
             SET original_name = $1, updated_at = NOW()
           WHERE id = $2`,
          [name, id]
        );

        return res.rowCount === 1;
      });

      // ✅ บันทึก log หลัง commit
      if (result) {
        await addLog(
          'info',
          'file-rename',
          'User renamed a file',
          { author_id, fileId: id, newName: name }
        );
      }

      return result;
    },
    toggleBookmark: async (_: any, { postId }: { postId: string }, ctx: any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);

      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      const start = Date.now();

      console.log("[toggleBookmark] :: ", author_id, postId);

      // ✅ ทำงานใน transaction
      const { revisionId, result } = await runInTransaction(author_id, async (client, ctx) => {
        // ตรวจว่ามี bookmark อยู่แล้วไหม
        const { rowCount: exists } = await client.query(
          `SELECT 1 FROM bookmarks WHERE post_id = $1 AND user_id = $2`,
          [postId, author_id]
        );

        if (exists) {
          // ถ้ามี → ลบออก
          await client.query(
            `DELETE FROM bookmarks WHERE post_id = $1 AND user_id = $2`,
            [postId, author_id]
          );
        } else {
          // ถ้ายังไม่มี → เพิ่มใหม่
          await client.query(
            `INSERT INTO bookmarks (post_id, user_id)
             VALUES ($1, $2)
             ON CONFLICT (post_id, user_id) DO NOTHING`,
            [postId, author_id]
          );
        }

        // Return final DB truth (protects against races / conflicts)
        const { rowCount: finalExists } = await client.query(
          `SELECT 1 FROM bookmarks WHERE post_id = $1 AND user_id = $2`,
          [postId, author_id]
        );

        return !!finalExists;
      });

      // ✅ publish realtime event AFTER commit only (best-effort)
      try {
        const payload: MyBookmarkStatusChangedPayload = {
          user_id: author_id,
          action: result ? "BOOKMARK" : "UNBOOKMARK",
          target_type: "POST",
          target_id: String(postId),
          bookmarked: !!result,
          updated_at: new Date().toISOString(),
        };

        await pubsub.publish(topicMyBookmarkStatusChanged(author_id), {
          myBookmarkStatusChanged: payload,
        });
      } catch (e) {
        console.warn("[toggleBookmark] publish myBookmarkStatusChanged failed", e);
      }

      // ✅ หลัง transaction commit → addLog สำหรับ external service (optional)
      await addLog(
        'info',
        'bookmark',
        'User toggled bookmark',
        { author_id, postId, isBookmarked: result }
      );

      return {
        status: true,
        isBookmarked: result,
        executionTime: `${((Date.now() - start) / 1000).toFixed(3)}s`,
      };
    },

    bookmark: async (_: any, { postId }: { postId: string }, ctx: any) => {
      const auth = requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      const start = Date.now();

      const { result } = await runInTransaction(author_id, async (client) => {
        await client.query(
          `INSERT INTO bookmarks (post_id, user_id)
           VALUES ($1, $2)
           ON CONFLICT (post_id, user_id) DO NOTHING`,
          [postId, author_id]
        );

        const { rowCount: finalExists } = await client.query(
          `SELECT 1 FROM bookmarks WHERE post_id = $1 AND user_id = $2`,
          [postId, author_id]
        );
        return !!finalExists;
      });

      try {
        const payload: MyBookmarkStatusChangedPayload = {
          user_id: author_id,
          action: result ? "BOOKMARK" : "UNBOOKMARK",
          target_type: "POST",
          target_id: String(postId),
          bookmarked: !!result,
          updated_at: new Date().toISOString(),
        };

        await pubsub.publish(topicMyBookmarkStatusChanged(author_id), {
          myBookmarkStatusChanged: payload,
        });
      } catch (e) {
        console.warn("[bookmark] publish myBookmarkStatusChanged failed", e);
      }

      return {
        status: true,
        isBookmarked: !!result,
        executionTime: `${((Date.now() - start) / 1000).toFixed(3)}s`,
      };
    },

    unbookmark: async (_: any, { postId }: { postId: string }, ctx: any) => {
      const auth = requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      const start = Date.now();

      const { result } = await runInTransaction(author_id, async (client) => {
        await client.query(
          `DELETE FROM bookmarks WHERE post_id = $1 AND user_id = $2`,
          [postId, author_id]
        );

        const { rowCount: finalExists } = await client.query(
          `SELECT 1 FROM bookmarks WHERE post_id = $1 AND user_id = $2`,
          [postId, author_id]
        );
        return !!finalExists;
      });

      const isBookmarked = !!result;

      try {
        const payload: MyBookmarkStatusChangedPayload = {
          user_id: author_id,
          action: isBookmarked ? "BOOKMARK" : "UNBOOKMARK",
          target_type: "POST",
          target_id: String(postId),
          bookmarked: isBookmarked,
          updated_at: new Date().toISOString(),
        };

        await pubsub.publish(topicMyBookmarkStatusChanged(author_id), {
          myBookmarkStatusChanged: payload,
        });
      } catch (e) {
        console.warn("[unbookmark] publish myBookmarkStatusChanged failed", e);
      }

      return {
        status: true,
        isBookmarked,
        executionTime: `${((Date.now() - start) / 1000).toFixed(3)}s`,
      };
    },
    markNotificationRead: async ( _: any, args: { id: string }, ctx: any ) => {
      const user = ctx.user;
      if (!user) throw new Error('Unauthorized');
      const { rows } = await query(
        `
        UPDATE notifications
        SET is_read = TRUE
        WHERE id = $1
          AND user_id = $2
        RETURNING id
        `,
        [args.id, user.id]
      );

      return rows.length > 0;
    },
    markAllNotificationsRead: async (_: any, __: any, ctx: any) => {
      const user = ctx.user;
      if (!user) throw new Error('Unauthorized');

      await query(
        `
        UPDATE notifications
        SET is_read = TRUE
        WHERE user_id = $1
          AND is_read = FALSE
        `,
        [user.id]
      );

      return true;
    },
    addComment: async (_: any, { post_id, content }: any, ctx: any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx); 

      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);
      
      const user = await getUserById(author_id); // { id, name, avatar, ... }

      console.log("[Mutation] addComment:", author_id, user);

      const id = uuidv4();

      // insert comment
      const { rows } = await query(
        `
        INSERT INTO comments (id, post_id, user_id, content)
        VALUES ($1,$2,$3,$4)
        RETURNING *
        `,
        [id, post_id, user.id, content]
      );
      const comment = rows[0];

      console.log("[Mutation] addComment-comment", comment);

      // หาเจ้าของโพสต์เพื่อแจ้งเตือน
      const postRes = await query(
        `SELECT id, author_id FROM posts WHERE id = $1`,
        [post_id]
      );
      const post = postRes.rows[0];

      if (post && post.author_id !== user.id) {
        await createNotification({
          user_id: post.author_id,
          type: 'POST_COMMENT',
          title: 'มีคอมเมนต์ใหม่ในโพสต์ของคุณ',
          message: `${user.name}: ${content.substring(0, 80)}`,
          entity_type: 'post',
          entity_id: post_id,
          data: {
            post_id,
            comment_id: comment.id,
            actor_id: user.id,
            actor_name: user.name,
          },
        });
      }

      // 👇 สร้าง object เวอร์ชัน GraphQL ที่มี user + replies
      const gqlComment = {
        ...comment,        // id, post_id, user_id, parent_id, content, created_at, updated_at
        user: {
          id: user.id,
          name: user.name,
          avatar: user.avatar ?? null,
          // ถ้ามี field อื่นใน type User ก็เติมได้
        },
        replies: [] as any[],
      };

      // broadcast subscription → ส่ง object แบบเดียวกับที่ mutation คืน
      await pubsub.publish(COMMENT_ADDED, {
        commentAdded: gqlComment,
      });

      // คืนค่า object ที่พร้อม field user + replies
      return gqlComment;
    },
    replyComment: async (_: any, { comment_id, content }: any, ctx: any) => {
      // const { author_id, scope, isAuthenticated } = requireAuth(ctx);

      const auth =  requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      const user = await getUserById(author_id);

      console.log("[replyComment]", author_id, user);

      const id = uuidv4();

      const { rows: baseRows } = await query(
        `SELECT * FROM comments WHERE id = $1`,
        [comment_id]
      );
      const parent = baseRows[0];
      if (!parent) throw new Error('Comment not found');

      const { rows } = await query(
        `
        INSERT INTO comments (id, post_id, user_id, parent_id, content)
        VALUES ($1,$2,$3,$4,$5)
        RETURNING *
        `,
        [id, parent.post_id, user.id, comment_id, content]
      );
      const reply = rows[0];

      // noti เหมือนเดิม
      if (parent.user_id !== user.id) {
        await createNotification({
          user_id: parent.user_id,
          type: 'POST_COMMENT_REPLY',
          title: 'มีคนตอบคอมเมนต์ของคุณ',
          message: `${user.name}: ${content.substring(0, 80)}`,
          entity_type: 'comment',
          entity_id: comment_id,
          data: {
            post_id: parent.post_id,
            comment_id,
            reply_id: reply.id,
            actor_id: user.id,
            actor_name: user.name,
          },
        });
      }

      const gqlReply = {
        ...reply,
        user: {
          id: user.id,
          name: user.name,
          avatar: user.avatar ?? null,
        },
        replies: [] as any[], // reply ใหม่ยังไม่มีลูกตัวเอง
      };

      await pubsub.publish(COMMENT_ADDED, {
        commentAdded: gqlReply,
      });

      return gqlReply;
    },
    updateComment: async (_: any, { id, content }: any, ctx: any) => {
      const user = ctx.user;
      if (!user) throw new Error('Unauthorized');

      // ตรวจว่าเป็นเจ้าของคอมเมนต์
      const { rows: ownRows } = await query(
        `SELECT * FROM comments WHERE id = $1`,
        [id]
      );
      const c = ownRows[0];
      if (!c) throw new Error('Comment not found');
      if (c.user_id !== user.id) throw new Error('Forbidden');

      const { rows } = await query(
        `
        UPDATE comments
        SET content = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING *
        `,
        [id, content]
      );

      const updated = rows[0];

      await pubsub.publish(COMMENT_UPDATED, {
        commentUpdated: updated,
      });

      return updated;
    },
    deleteComment: async (_: any, { id }: any, ctx: any) => {
      const user = ctx.user;
      if (!user) throw new Error('Unauthorized');

      const { rows: ownRows } = await query(
        `SELECT * FROM comments WHERE id = $1`,
        [id]
      );
      const c = ownRows[0];
      if (!c) return false;
      if (c.user_id !== user.id) throw new Error('Forbidden');

      await query(`DELETE FROM comments WHERE id = $1`, [id]);

      await pubsub.publish(COMMENT_DELETED, {
        commentDeleted: id,
      });

      return true;
    },
    
    reportScamPhone: async (_: any, { input }: any, ctx: any) => {
      const {
        phone,
        category,
        note,
        client_id,
        device_model,
        os_version,
        app_version,
      } = input;

      console.log("[reportScamPhone] input:", input);

      const auth = requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) throw new Error("Unauthenticated");
      const author_id = String(auth.author_id);

      const normalized = normalizeTel(phone);
      if (!normalized) throw new Error("Invalid phone");

      const cat = String(category || "SCAM");

      const { result } = await runInTransaction(author_id, async (client: any) => {
        // 1) INSERT -> scam_phone_reports
        //    (มี phone_normalized เป็น NOT NULL ตาม error ที่คุณเจอ)
        await client.query(
          `
          INSERT INTO scam_phone_reports
            (user_id, phone, phone_normalized, category, note, client_id, device_model, os_version, app_version)
          VALUES
            ($1::uuid, $2, $3, $4, $5, $6::uuid, $7, $8, $9)
          `,
          [
            author_id,
            normalized,
            normalized,
            cat,
            note ?? null,
            client_id,
            device_model ?? null,
            os_version ?? null,
            app_version ?? null,
          ]
        );

        // 2) UPSERT -> scam_phones_summary (ตัด source_reports ออก)
        const { rows } = await client.query(
          `
          INSERT INTO scam_phones_summary
            (phone, report_count, last_report_at, risk_level, updated_at)
          VALUES
            ($1, 1, now(), 10, now())
          ON CONFLICT (phone)
          DO UPDATE SET
              report_count   = scam_phones_summary.report_count + 1,
              last_report_at = now(),
              risk_level     = GREATEST(scam_phones_summary.risk_level, 10),
              updated_at     = now()
          RETURNING
            phone,
            report_count,
            last_report_at,
            risk_level,
            post_ids,
            is_deleted,
            updated_at;
          `,
          [normalized]
        );

        const row = rows[0];

        // 3) เติม fields ที่ GraphQL schema/app ต้องการ แต่ DB ไม่มีจริง
        return {
          phone: row.phone,
          report_count: Number(row.report_count || 0),
          last_report_at: row.last_report_at ? new Date(row.last_report_at).toISOString() : null,
          risk_level: Number(row.risk_level || 0),
          updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
          is_deleted: !!row.is_deleted,
          post_ids: Array.isArray(row.post_ids) ? row.post_ids : [],
          tags: [],   // ✅ DB ไม่มี tags
          ctx: null,  // ✅ DB ไม่มี ctx
        };
      });

      return result;
    },

    unblockScamPhone: async (_: any, { input }: any, ctx: any) => {
      const { phone, client_id, device_model, os_version, app_version } = input;

      const auth = requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id)
        throw new Error("Unauthenticated");

      const author_id = String(auth.author_id);

      const normalized = normalizeTel(phone);
      if (!normalized) throw new Error("Invalid phone");

      const { result } = await runInTransaction(author_id, async (client: any) => {

        // ✅ (1) log unblock event (ถ้ามี table นี้)
        await client.query(
          `
          INSERT INTO scam_phone_unblocks
            (user_id, phone, client_id, device_model, os_version, app_version)
          VALUES
            ($1::uuid, $2, $3::uuid, $4, $5, $6)
          `,
          [
            author_id,
            normalized,
            client_id,
            device_model ?? null,
            os_version ?? null,
            app_version ?? null,
          ]
        );

        // ✅ (2) update summary
        // ❌ เอา ctx ออก
        const { rows } = await client.query(
          `
          INSERT INTO scam_phones_summary
            (phone, report_count, last_report_at, risk_level, updated_at)
          VALUES
            ($1, 0, NULL, 0, now())
          ON CONFLICT (phone)
          DO UPDATE SET
              risk_level = GREATEST(COALESCE(scam_phones_summary.risk_level, 0) - 10, 0),
              updated_at = now()
          RETURNING
            phone,
            report_count,
            last_report_at,
            risk_level,
            updated_at,
            COALESCE(is_deleted, false) AS is_deleted,
            COALESCE(post_ids, ARRAY[]::uuid[]) AS post_ids;
          `,
          [normalized]
        );

        const row = rows?.[0] || {};

        return {
          phone: String(row.phone || normalized),
          report_count: Number(row.report_count || 0),
          last_report_at: toIsoOrNull(row.last_report_at),
          risk_level: Number(row.risk_level || 0),
          updated_at:
            toIsoOrNull(row.updated_at) || new Date().toISOString(),

          // เติม default field ให้ GraphQL
          tags: [],                 // ถ้าไม่มีใน DB
          is_deleted: !!row.is_deleted,
          post_ids: uuidArrayToStringArray(row.post_ids),
          ctx: null,                // 🔥 ใส่ null แทน (ไม่ต้อง SELECT จาก DB)
        };
      });

      return result;
    },
    createSupportTicket: async (_: any, { input }: any, ctx: any) => {
      const ticketId = `SUP-${Date.now()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
      const ip =
        ctx?.req?.headers?.get?.("x-forwarded-for")?.split(",")[0]?.trim() ||
        ctx?.req?.headers?.get?.("x-real-ip") ||
        ctx?.req?.headers?.get?.("cf-connecting-ip") ||
        null;

      await query(
        `INSERT INTO support_tickets
           (ticket_id, name, email, phone, topic, subject, message, ref, page_url, user_agent, ip)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          ticketId,
          String(input.name || "").trim() || null,
          String(input.email || "").trim(),
          input.phone ? String(input.phone).trim() : null,
          String(input.topic || "").trim(),
          String(input.subject || "").trim(),
          String(input.message || "").trim(),
          input.ref ? String(input.ref).trim() : null,
          input.pageUrl ? String(input.pageUrl).slice(0, 1000) : null,
          input.userAgent ? String(input.userAgent).slice(0, 1000) : null,
          ip,
        ]
      );

      const subject = `[${ticketId}] ${input.topic.toUpperCase()}: ${input.subject}`;

      const html = `
        <h2>New Support Ticket</h2>
        <p><b>Ticket:</b> ${ticketId}</p>
        <p><b>Name:</b> ${escapeHtml(String(input.name || "-"))}</p>
        <p><b>Email:</b> ${escapeHtml(String(input.email || "-"))}</p>
        <p><b>Phone:</b> ${escapeHtml(String(input.phone ?? "-"))}</p>
        <p><b>Topic:</b> ${escapeHtml(String(input.topic || "-"))}</p>
        <p><b>Ref:</b> ${escapeHtml(String(input.ref ?? "-"))}</p>
        <p><b>Page:</b> ${escapeHtml(String(input.pageUrl ?? "-"))}</p>
        <p><b>User-Agent:</b> ${escapeHtml(String(input.userAgent ?? "-"))}</p>
        <hr />
        <pre style="white-space:pre-wrap">${escapeHtml(String(input.message || ""))}</pre>
      `;

      try {
        await sendEmail(
          {
            to: process.env.SUPPORT_TO_EMAIL ?? "support@yourdomain.com",
            subject,
            html,
            text: `${input.message}\n\nFrom: ${input.name} <${input.email}>`,
          },
          { category: "support", triggeredBy: "resolvers:createSupportTicket" }
        );
      } catch (e: any) {
        console.error("[support] email notification failed", e?.message || e);
      }

      return { ok: true, message: "Received. We will reply soon.", ticketId };
    },
    bmsUpdateSupportTicket: async (_: any, { input }: any, ctx: any) => {
      await requirePlatformOnly(ctx);
      const ticketId = String(input.id || "").trim();
      const nextStatus = input.status ? String(input.status).trim() : null;
      const comment = input.comment ? String(input.comment).trim() : "";
      const allowedStatuses = new Set(["open", "pending", "closed"]);
      const actorId = ctx?.admin?.id ? String(ctx.admin.id) : null;
      const actorEmail = ctx?.admin?.email ? String(ctx.admin.email) : null;

      if (!ticketId) {
        throw new GraphQLError("ticket id is required", { extensions: { code: "BAD_USER_INPUT" } });
      }
      if (nextStatus && !allowedStatuses.has(nextStatus)) {
        throw new GraphQLError("invalid support ticket status", { extensions: { code: "BAD_USER_INPUT" } });
      }
      if (!nextStatus && !comment) {
        throw new GraphQLError("status or comment is required", { extensions: { code: "BAD_USER_INPUT" } });
      }

      const { result } = await runInTransaction(actorId || "00000000-0000-0000-0000-000000000000", async (client) => {
        const current = await client.query<any>(
          `SELECT id, ticket_id, name, email, phone, topic, subject, message, ref, page_url,
                  user_agent, ip, status, created_at, updated_at, closed_at
             FROM support_tickets
            WHERE id = $1
            FOR UPDATE`,
          [ticketId]
        );
        const row = current.rows[0];
        if (!row) {
          throw new GraphQLError("support ticket not found", { extensions: { code: "NOT_FOUND" } });
        }

        const fromStatus = row.status;
        const toStatus = nextStatus || fromStatus;

        if (nextStatus && nextStatus !== fromStatus) {
          const closedAtSql = nextStatus === "closed"
            ? "now()"
            : fromStatus === "closed"
            ? "NULL"
            : "closed_at";
          await client.query(
            `UPDATE support_tickets
                SET status = $2,
                    updated_at = now(),
                    closed_at = ${closedAtSql}
              WHERE id = $1`,
            [ticketId, nextStatus]
          );
        } else if (comment) {
          await client.query(`UPDATE support_tickets SET updated_at = now() WHERE id = $1`, [ticketId]);
        }

        if (comment || nextStatus) {
          const body = comment || `Status changed: ${fromStatus} -> ${toStatus}`;
          await client.query(
            `INSERT INTO support_ticket_comments
               (ticket_id, author_id, author_email, from_status, to_status, body)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [ticketId, actorId, actorEmail, fromStatus, toStatus, body]
          );
        }

        const updated = await client.query<any>(
          `SELECT id, ticket_id, name, email, phone, topic, subject, message, ref, page_url,
                  user_agent, ip, status, created_at, updated_at, closed_at
             FROM support_tickets
            WHERE id = $1`,
          [ticketId]
        );
        const comments = await client.query<any>(
          `SELECT id, ticket_id, author_id, author_email, from_status, to_status, body, created_at
             FROM support_ticket_comments
            WHERE ticket_id = $1
            ORDER BY created_at DESC`,
          [ticketId]
        );
        return mapSupportTicket(updated.rows[0], comments.rows);
      });

      return result;
    },

    uploadDiagnostics: async (_: any, { input }: any, ctx: any) => {
      const auth = requireAuth(ctx, { optionalWeb: true, optionalAndroid: true });
      const actorId = auth?.author_id ? String(auth.author_id) : null;

      const payload = input || {};
      const exportedAt = String(payload.exportedAt || "").trim();
      const platform = String(payload.platform || "").trim();
      const diagnosticsJson = String(payload.diagnosticsJson || "").trim();

      if (!platform) {
        throw new GraphQLError("platform is required", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }

      if (!exportedAt) {
        throw new GraphQLError("exportedAt is required", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }

      if (!diagnosticsJson) {
        throw new GraphQLError("diagnosticsJson is required", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }

      const uploadId = randomUUID();
      const diagnosticsLength = diagnosticsJson.length;
      const callLogsLength = String(payload.callCheckLogsJson || "").length;

      // Minimal payload safety to avoid oversized log rows or accidental crashes.
      const safeMeta = {
        uploadId,
        userId: payload.userId ? String(payload.userId) : actorId,
        actorId,
        platform,
        appVersion: String(payload.appVersion || ""),
        buildNumber: String(payload.buildNumber || ""),
        packageName: String(payload.packageName || ""),
        deviceModel: String(payload.deviceModel || ""),
        osVersion: String(payload.osVersion || ""),
        exportedAt,
        diagnosticsSize: diagnosticsLength,
        callCheckLogsSize: callLogsLength,
      };

      try {
        // Debug helpers for on-device issue tracing without exposing auth secrets.
        console.info("[uploadDiagnostics] mutation reached", {
          uploadId,
          inputKeys: Object.keys(payload || {}),
          platform,
          packageName: safeMeta.packageName,
        });

        await addLog("info", "diagnostics-upload", "Mobile diagnostics uploaded", {
          ...safeMeta,
          diagnosticsPreview: diagnosticsJson.slice(0, 4000),
          callCheckLogsPreview: String(payload.callCheckLogsJson || "").slice(0, 4000),
        });

        return {
          success: true,
          message: "Diagnostics uploaded",
          uploadId,
        };
      } catch (err: any) {
        console.error("[uploadDiagnostics] failed", {
          uploadId,
          message: err?.message || "unknown",
        });

        await addLog("error", "diagnostics-upload", "Mobile diagnostics upload failed", {
          ...safeMeta,
          error: err?.message || "unknown",
        });

        return {
          success: false,
          message: "Failed to store diagnostics",
          uploadId,
        };
      }
    },

    reportBankAccount: async (_: any, { input }: any, ctx: any) => {
      const {
        bank_name,
        account_no,
        note,
        client_id,
        device_model,
        os_version,
        app_version,
      } = input;

      // const { author_id } = requireAuth(ctx, { optionalWeb: true, optionalAndroid: true });

      const auth =  requireAuth(ctx, { optionalWeb: true, optionalAndroid: true });
      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }
      const author_id = String(auth.author_id);

      const bankName = String(bank_name || "").trim();
      const accRaw = String(account_no || "").trim();
      const accNorm = normalizeAccountNo(accRaw);

      if (!bankName || !accNorm) {
        throw new GraphQLError("bank_name and account_no are required", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }

      const { result } = await runInTransaction(author_id, async (client: any) => {
        const clientIdSafe = String(client_id || "");
        if (!clientIdSafe) {
          throw new GraphQLError("Missing client_id", { extensions: { code: "BAD_USER_INPUT" } });
        }

        // Detect legacy UNIQUE(client_id) index. We must not enforce single-target per client
        // when the index is already dropped.
        const { rows: legacyIdxRows } = await client.query(
          `
          SELECT 1
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'scam_bank_account_reports_client_id_ux'
          LIMIT 1
          `
        );
        const hasLegacyClientIdUnique = legacyIdxRows.length > 0;

        // If legacy index exists, prevent a hard INSERT failure that would abort the tx.
        if (hasLegacyClientIdUnique) {
          const { rows: existingRows } = await client.query(
            `
            SELECT bank_name, account_norm
            FROM scam_bank_account_reports
            WHERE client_id = $1
            LIMIT 1
            `,
            [clientIdSafe]
          );

          const existing = existingRows?.[0];
          if (existing) {
            const sameTarget =
              String(existing.bank_name || "").trim() === bankName &&
              String(existing.account_norm || "").trim() === accNorm;

            if (!sameTarget) {
              throw new GraphQLError(
                "This DB still has legacy UNIQUE(client_id) on scam_bank_account_reports, so one device cannot report multiple bank accounts. Apply the migration to drop scam_bank_account_reports_client_id_ux.",
                { extensions: { code: "FAILED_PRECONDITION" } }
              );
            }

            // Idempotent: already reported same bank/account from this client_id.
            // Continue to read summary without issuing an INSERT.
          } else {
            try {
              await client.query(
                `
                INSERT INTO scam_bank_account_reports
                  (bank_name, account_no, account_norm, note, client_id, device_model, os_version, app_version)
                VALUES
                  ($1,$2,$3,$4,$5,$6,$7,$8)
                ON CONFLICT (client_id, bank_name, account_norm)
                DO UPDATE SET
                  account_no   = EXCLUDED.account_no,
                  note         = EXCLUDED.note,
                  device_model = EXCLUDED.device_model,
                  os_version   = EXCLUDED.os_version,
                  app_version  = EXCLUDED.app_version
                `,
                [
                  bankName,
                  accRaw,
                  accNorm,
                  note || null,
                  clientIdSafe,
                  device_model || null,
                  os_version || null,
                  app_version || null,
                ]
              );
            } catch (e: any) {
              const msg = String(e?.message || "");
              const isDup =
                msg.includes("scam_bank_account_reports_client_id_ux") ||
                msg.includes("duplicate key value violates unique constraint \"scam_bank_account_reports_client_id_ux\"");
              if (isDup) {
                throw new GraphQLError(
                  "This DB still has legacy UNIQUE(client_id) on scam_bank_account_reports. Apply the migration to drop scam_bank_account_reports_client_id_ux.",
                  { extensions: { code: "FAILED_PRECONDITION" } }
                );
              }
              throw e;
            }
          }
        } else {
          // Normal path (after migration): allow many rows per client_id, idempotent per (client_id, bank_name, account_norm)
          await client.query(
            `
            INSERT INTO scam_bank_account_reports
              (bank_name, account_no, account_norm, note, client_id, device_model, os_version, app_version)
            VALUES
              ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT (client_id, bank_name, account_norm)
            DO UPDATE SET
              account_no   = EXCLUDED.account_no,
              note         = EXCLUDED.note,
              device_model = EXCLUDED.device_model,
              os_version   = EXCLUDED.os_version,
              app_version  = EXCLUDED.app_version
            `,
            [
              bankName,
              accRaw,
              accNorm,
              note || null,
              clientIdSafe,
              device_model || null,
              os_version || null,
              app_version || null,
            ]
          );
        }

        // 2) trigger จะ upsert summary แล้ว -> read summary กลับ
        const { rows } = await client.query(
          `
          SELECT
            bank_name,
            account_no,
            account_norm,
            report_count,
            last_report_at,
            risk_level,
            updated_at
          FROM scam_bank_accounts_summary
          WHERE bank_name = $1 AND account_norm = $2
          LIMIT 1
          `,
          [bankName, accNorm]
        );

        const s = rows[0];
        if (!s) {
          // safety fallback (ไม่น่าเกิด)
          return {
            bank_name: bankName,
            account_no_masked: maskAccount(accNorm),
            account_norm: accNorm,
            report_count: 1,
            last_report_at: new Date().toISOString(),
            risk_level: 10,
            updated_at: new Date().toISOString(),
          };
        }

        return {
          bank_name: s.bank_name,
          account_no_masked: maskAccount(s.account_no || s.account_norm),
          account_norm: s.account_norm,
          report_count: Number(s.report_count || 0),
          last_report_at: s.last_report_at ? new Date(s.last_report_at).toISOString() : null,
          risk_level: Number(s.risk_level || calcRisk(Number(s.report_count || 0))),
          updated_at: s.updated_at ? new Date(s.updated_at).toISOString() : new Date().toISOString(),
        };
      });

      return result;
    },

    reportScamBankAccount: async (_: any, { input }: any, ctx: any) => {
      const {
        bank_name,
        account,
        note,
        client_id,
        device_model,
        os_version,
        app_version,
      } = input;

      const auth = requireAuth(ctx);

      if (!auth.isAuthenticated || !auth.author_id) {
        throw new Error("Unauthenticated");
      }

      const authorIdSafe = String(auth.author_id);
      const bankNameSafe = String(bank_name || "").trim() || "UNKNOWN";
      const accountNoSafe = String(account || "").trim();
      const accountNormSafe = normalizeBankAccount(account);
      const noteSafe = note?.trim() ? note.trim() : null;
      const clientIdSafe = String(client_id || "");

      if (!accountNormSafe) {
        throw new Error("Invalid account");
      }

      const { result } = await runInTransaction(authorIdSafe, async (client: any) => {
        if (!clientIdSafe) {
          throw new GraphQLError("Missing client_id", { extensions: { code: "BAD_USER_INPUT" } });
        }

        // Multi-device source-of-truth: treat "my blocked bank" as user-scoped.
        // If this user already reported this bank+account, skip INSERT to avoid duplicates across devices.
        const { rows: myExistingRows } = await client.query(
          `
          SELECT 1
          FROM scam_bank_account_reports
          WHERE user_id = $1::uuid AND bank_name = $2 AND account_norm = $3
          LIMIT 1
          `,
          [authorIdSafe, bankNameSafe, accountNormSafe]
        );

        const alreadyReportedByMe = myExistingRows.length > 0;

        // Detect legacy UNIQUE(client_id) index so we don't accidentally block multi-report after migration.
        const { rows: legacyIdxRows } = await client.query(
          `
          SELECT 1
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'scam_bank_account_reports_client_id_ux'
          LIMIT 1
          `
        );
        const hasLegacyClientIdUnique = legacyIdxRows.length > 0;

        if (alreadyReportedByMe) {
          // Keep latest metadata (note/device/app) for observability, but don't create a new report row.
          await client.query(
            `
            UPDATE scam_bank_account_reports
            SET
              account_no   = $4,
              note         = $5,
              client_id    = $6,
              device_model = $7,
              os_version   = $8,
              app_version  = $9
            WHERE user_id = $1::uuid AND bank_name = $2 AND account_norm = $3
            `,
            [
              authorIdSafe,
              bankNameSafe,
              accountNormSafe,
              accountNoSafe,
              noteSafe,
              clientIdSafe,
              device_model ?? null,
              os_version ?? null,
              app_version ?? null,
            ]
          );
        } else if (hasLegacyClientIdUnique) {
          const { rows: existingRows } = await client.query(
            `
            SELECT bank_name, account_norm
            FROM scam_bank_account_reports
            WHERE client_id = $1
            LIMIT 1
            `,
            [clientIdSafe]
          );
          const existing = existingRows?.[0];
          if (existing) {
            const sameTarget =
              String(existing.bank_name || "").trim() === bankNameSafe &&
              String(existing.account_norm || "").trim() === accountNormSafe;
            if (!sameTarget) {
              throw new GraphQLError(
                "This DB still has legacy UNIQUE(client_id) on scam_bank_account_reports, so one device cannot report multiple bank accounts. Apply the migration to drop scam_bank_account_reports_client_id_ux.",
                { extensions: { code: "FAILED_PRECONDITION" } }
              );
            }
            // Idempotent: same target already exists; skip INSERT.
          } else {
            try {
              await client.query(
                `
                INSERT INTO scam_bank_account_reports
                  (
                    user_id,
                    bank_name,
                    account_no,
                    account_norm,
                    note,
                    client_id,
                    device_model,
                    os_version,
                    app_version,
                    created_at
                  )
                VALUES
                  (
                    $1::uuid,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7,
                    $8,
                    $9,
                    now()
                  )
                ON CONFLICT (client_id, bank_name, account_norm)
                DO UPDATE SET
                  user_id      = EXCLUDED.user_id,
                  account_no   = EXCLUDED.account_no,
                  note         = EXCLUDED.note,
                  device_model = EXCLUDED.device_model,
                  os_version   = EXCLUDED.os_version,
                  app_version  = EXCLUDED.app_version
                `,
                [
                  authorIdSafe,
                  bankNameSafe,
                  accountNoSafe,
                  accountNormSafe,
                  noteSafe,
                  clientIdSafe,
                  device_model ?? null,
                  os_version ?? null,
                  app_version ?? null,
                ]
              );
            } catch (e: any) {
              const msg = String(e?.message || "");
              const isDup =
                msg.includes("scam_bank_account_reports_client_id_ux") ||
                msg.includes("duplicate key value violates unique constraint \"scam_bank_account_reports_client_id_ux\"");
              if (isDup) {
                // Do not attempt any follow-up queries in this transaction; it's aborted.
                throw new GraphQLError(
                  "This DB still has legacy UNIQUE(client_id) on scam_bank_account_reports. Apply the migration to drop scam_bank_account_reports_client_id_ux.",
                  { extensions: { code: "FAILED_PRECONDITION" } }
                );
              }
              throw e;
            }
          }
        } else {
          // After migration: allow many reports per client_id; idempotent per composite key.
          await client.query(
            `
            INSERT INTO scam_bank_account_reports
              (
                user_id,
                bank_name,
                account_no,
                account_norm,
                note,
                client_id,
                device_model,
                os_version,
                app_version,
                created_at
              )
            VALUES
              (
                $1::uuid,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                now()
              )
            ON CONFLICT (client_id, bank_name, account_norm)
            DO UPDATE SET
              user_id      = EXCLUDED.user_id,
              account_no   = EXCLUDED.account_no,
              note         = EXCLUDED.note,
              device_model = EXCLUDED.device_model,
              os_version   = EXCLUDED.os_version,
              app_version  = EXCLUDED.app_version
            `,
            [
              authorIdSafe,
              bankNameSafe,
              accountNoSafe,
              accountNormSafe,
              noteSafe,
              clientIdSafe,
              device_model ?? null,
              os_version ?? null,
              app_version ?? null,
            ]
          );
        }

        // Read summary (maintained by trigger scam_bank_account_reports_agg_tg on INSERT)
        const { rows } = await client.query(
          `
          SELECT
            bank_name,
            account_no,
            account_norm,
            report_count,
            last_report_at,
            risk_level,
            updated_at
          FROM scam_bank_accounts_summary
          WHERE bank_name = $1 AND account_norm = $2
          LIMIT 1
          `,
          [bankNameSafe, accountNormSafe]
        );

        const s = rows[0];
        if (!s) {
          // Fallback (should be rare): compute from reports
          const { rows: aggRows } = await client.query(
            `
            SELECT COUNT(*)::int AS cnt, MAX(created_at) AS last_at
            FROM scam_bank_account_reports
            WHERE bank_name = $1 AND account_norm = $2
            `,
            [bankNameSafe, accountNormSafe]
          );
          const cnt = Number(aggRows?.[0]?.cnt || 0);
          const lastAt = aggRows?.[0]?.last_at || null;
          return shapeScamBankAccount({
            bank_name: bankNameSafe,
            account_no: accountNoSafe,
            account_norm: accountNormSafe,
            report_count: cnt,
            last_report_at: lastAt,
            risk_level: cnt > 0 ? 10 : 0,
            updated_at: new Date().toISOString(),
          });
        }

        return shapeScamBankAccount(s);
      });

      // Publish AFTER commit only
      try {
        const payload: MyBankBlockStatusChangedPayload = {
          user_id: authorIdSafe,
          action: "BLOCK",
          bank_name: bankNameSafe,
          account_norm: accountNormSafe,
          blocked: true,
          updated_at: new Date().toISOString(),
        };
        await pubsub.publish(topicMyBankBlockStatusChanged(authorIdSafe), {
          myBankBlockStatusChanged: payload,
        });
      } catch (e) {
        console.warn("[reportScamBankAccount] publish myBankBlockStatusChanged failed", e);
      }

      return result;
    },

    unreportScamBankAccount: async (_: any, { input }: any, ctx: any) => {
      const { bank_name, account } = input;

      const auth = requireAuth(ctx);
      if (!auth.isAuthenticated || !auth.author_id) throw new Error("Unauthenticated");

      const bankNameSafe = String(bank_name || "").trim() || "UNKNOWN";
      const accNorm = normalizeBankAccount(account);
      if (!accNorm) throw new Error("Invalid account");

      const authorIdSafe = String(auth.author_id);

      const { result } = await runInTransaction(authorIdSafe, async (client: any) => {
        // 1) Multi-device: unreport is USER-scoped (remove my report regardless of device)
        await client.query(
          `
          DELETE FROM scam_bank_account_reports
          WHERE user_id = $1::uuid
            AND bank_name = $2
            AND account_norm = $3
          `,
          [authorIdSafe, bankNameSafe, accNorm]
        );

        // 2) rebuild summary จาก reports ที่เหลือ
        const { rows: aggRows } = await client.query(
          `
          SELECT
            COUNT(*)::int AS cnt,
            MAX(created_at) AS last_at
          FROM scam_bank_account_reports
          WHERE bank_name = $1 AND account_norm = $2
          `,
          [bankNameSafe, accNorm]
        );

        const cnt = Number(aggRows?.[0]?.cnt || 0);
        const lastAt = aggRows?.[0]?.last_at || null;

        if (cnt <= 0) {
          // ไม่มีรายงานเหลือ → ลบ summary ทิ้งเลย
          await client.query(
            `DELETE FROM scam_bank_accounts_summary WHERE bank_name = $1 AND account_norm = $2`,
            [bankNameSafe, accNorm]
          );

          return shapeScamBankAccount({
            bank_name: bankNameSafe,
            account_no: String(account || "").trim(),
            account_norm: accNorm,
            report_count: 0,
            last_report_at: null,
            risk_level: 0,
            updated_at: new Date().toISOString(),
          });
        }

        const nextRisk = Math.min(cnt * 10, 100);

        const { rows: upRows } = await client.query(
          `
          UPDATE scam_bank_accounts_summary
          SET
            report_count   = $3,
            last_report_at = $4,
            risk_level     = $5,
            updated_at     = now()
          WHERE bank_name = $1 AND account_norm = $2
          RETURNING
            bank_name, account_no, account_norm, report_count, last_report_at, risk_level, updated_at
          `,
          [bankNameSafe, accNorm, cnt, lastAt, nextRisk]
        );

        // ถ้าดันไม่มีแถว (edge) → insert ใหม่
        const row = upRows?.[0];
        if (row) return shapeScamBankAccount(row);

        const { rows: insRows } = await client.query(
          `
          INSERT INTO scam_bank_accounts_summary
            (bank_name, account_no, account_norm, report_count, last_report_at, risk_level, updated_at)
          VALUES
            ($1, $2, $3, $4, $5, $6, now())
          RETURNING
            bank_name, account_no, account_norm, report_count, last_report_at, risk_level, updated_at
          `,
          [bankNameSafe, String(account || "").trim(), accNorm, cnt, lastAt, nextRisk]
        );

        return shapeScamBankAccount(insRows[0]);
      });

      // Publish AFTER commit only
      try {
        const payload: MyBankBlockStatusChangedPayload = {
          user_id: authorIdSafe,
          action: "UNBLOCK",
          bank_name: bankNameSafe,
          account_norm: accNorm,
          blocked: false,
          updated_at: new Date().toISOString(),
        };
        await pubsub.publish(topicMyBankBlockStatusChanged(authorIdSafe), {
          myBankBlockStatusChanged: payload,
        });
      } catch (e) {
        console.warn("[unreportScamBankAccount] publish myBankBlockStatusChanged failed", e);
      }

      return result;
    },

    // ================================
    // Role Management Mutations
    // ================================
    createRole: async (_: any, { input }: { input: any }, ctx: any) => {
      await requirePlatformOnly(ctx); // role = นิยามกลางทั้งระบบ → platform admin เท่านั้น
      const { author_id } = requireAuth(ctx);
      console.log('[Mutation] createRole:', author_id, input);

      const { name, description, is_active } = input;

      // Validate name
      const trimmedName = String(name || '').trim();
      if (!trimmedName) {
        throw new Error('Role name is required and cannot be empty');
      }

      if (trimmedName.length < 2 || trimmedName.length > 50) {
        throw new Error('Role name must be between 2 and 50 characters');
      }

      try {
        // Check for duplicate name
        const { rows: existing } = await query(
          `SELECT id FROM roles WHERE LOWER(name) = LOWER($1) LIMIT 1`,
          [trimmedName]
        );

        if (existing.length > 0) {
          throw new Error(`Role with name "${trimmedName}" already exists`);
        }

        // Insert new role
        const { rows } = await query(
          `INSERT INTO roles (name, description, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, now(), now())
           RETURNING id, name, description, is_active, created_at, updated_at`,
          [trimmedName, description || null, is_active !== false]
        );

        console.log('[Mutation] createRole success:', rows[0]);
        return rows[0];
      } catch (err: any) {
        console.error('[Mutation] createRole error:', err);
        throw new Error(err.message || 'Failed to create role');
      }
    },

    updateRole: async (_: any, { id, input }: { id: string; input: any }, ctx: any) => {
      await requirePlatformOnly(ctx); // role = นิยามกลางทั้งระบบ → platform admin เท่านั้น
      const { author_id } = requireAuth(ctx);
      console.log('[Mutation] updateRole:', author_id, id, input);

      const { name, description, is_active } = input;

      try {
        // Check if role exists
        const { rows: existingRole } = await query(
          `SELECT id, name FROM roles WHERE id = $1 LIMIT 1`,
          [id]
        );

        if (existingRole.length === 0) {
          throw new Error('Role not found');
        }

        // Build dynamic update
        const updates: string[] = [];
        const params: any[] = [];
        let paramIndex = 1;

        if (name !== undefined) {
          const trimmedName = String(name || '').trim();
          if (!trimmedName) {
            throw new Error('Role name cannot be empty');
          }

          if (trimmedName.length < 2 || trimmedName.length > 50) {
            throw new Error('Role name must be between 2 and 50 characters');
          }

          // Check for duplicate name (excluding current role)
          const { rows: duplicate } = await query(
            `SELECT id FROM roles WHERE LOWER(name) = LOWER($1) AND id != $2 LIMIT 1`,
            [trimmedName, id]
          );

          if (duplicate.length > 0) {
            throw new Error(`Role with name "${trimmedName}" already exists`);
          }

          updates.push(`name = $${paramIndex++}`);
          params.push(trimmedName);
        }

        if (description !== undefined) {
          updates.push(`description = $${paramIndex++}`);
          params.push(description || null);
        }

        if (is_active !== undefined) {
          updates.push(`is_active = $${paramIndex++}`);
          params.push(!!is_active);
        }

        if (updates.length === 0) {
          // No updates, return current role
          const { rows } = await query(
            `SELECT id, name, description, is_active, created_at, updated_at FROM roles WHERE id = $1`,
            [id]
          );
          return rows[0];
        }

        // Add updated_at
        updates.push(`updated_at = now()`);

        // Add id parameter
        params.push(id);

        const { rows } = await query(
          `UPDATE roles 
           SET ${updates.join(', ')}
           WHERE id = $${paramIndex}
           RETURNING id, name, description, is_active, created_at, updated_at`,
          params
        );

        console.log('[Mutation] updateRole success:', rows[0]);
        return rows[0];
      } catch (err: any) {
        console.error('[Mutation] updateRole error:', err);
        throw new Error(err.message || 'Failed to update role');
      }
    },

    deleteRole: async (_: any, { id }: { id: string }, ctx: any) => {
      await requirePlatformOnly(ctx); // role = นิยามกลางทั้งระบบ → platform admin เท่านั้น
      const { author_id } = requireAuth(ctx);
      console.log('[Mutation] deleteRole:', author_id, id);

      try {
        // Check if role exists
        const { rows: existingRole } = await query(
          `SELECT id, name FROM roles WHERE id = $1 LIMIT 1`,
          [id]
        );

        if (existingRole.length === 0) {
          throw new Error('Role not found');
        }

        // Check if any users are using this role
        const { rows: usersWithRole } = await query(
          `SELECT COUNT(*)::int AS count FROM users WHERE role_id = $1`,
          [id]
        );

        const userCount = usersWithRole[0]?.count || 0;

        if (userCount > 0) {
          throw new Error(
            `Cannot delete role "${existingRole[0].name}" because ${userCount} user(s) are assigned to it. ` +
            `Please reassign these users to another role or deactivate the role instead.`
          );
        }

        // Safe to delete (no users are using this role)
        await query(`DELETE FROM roles WHERE id = $1`, [id]);

        console.log('[Mutation] deleteRole success:', id);
        return true;
      } catch (err: any) {
        console.error('[Mutation] deleteRole error:', err);
        throw new Error(err.message || 'Failed to delete role');
      }
    },

    setRoleActive: async (_: any, { id, is_active }: { id: string; is_active: boolean }, ctx: any) => {
      const { author_id } = requireAuth(ctx);
      console.log('[Mutation] setRoleActive:', author_id, id, is_active);

      try {
        // Check if role exists
        const { rows: existingRole } = await query(
          `SELECT id FROM roles WHERE id = $1 LIMIT 1`,
          [id]
        );

        if (existingRole.length === 0) {
          throw new Error('Role not found');
        }

        // Update is_active status
        const { rows } = await query(
          `UPDATE roles 
           SET is_active = $1, updated_at = now()
           WHERE id = $2
           RETURNING id, name, description, is_active, created_at, updated_at`,
          [!!is_active, id]
        );

        console.log('[Mutation] setRoleActive success:', rows[0]);
        return rows[0];
      } catch (err: any) {
        console.error('[Mutation] setRoleActive error:', err);
        throw new Error(err.message || 'Failed to set role active status');
      }
    },

    ...phoneResolvers.Mutation,
    ...contactSpamResolvers.Mutation,
    ...bmsOrdersResolvers.Mutation,
    ...bmsProductsResolvers.Mutation,
    ...bmsCustomersResolvers.Mutation,
    ...bmsDashboardResolvers.Mutation,
    ...bmsAiQualityResolvers.Mutation,
    ...bmsChannelsResolvers.Mutation,
    ...bmsAiConfigResolvers.Mutation,
    ...bmsSqlConsoleResolvers.Mutation,
    ...bmsSaasResolvers.Mutation,
    ...bmsPurchaseResolvers.Mutation,
    ...bmsPaymentsResolvers.Mutation,
    ...bmsShippingResolvers.Mutation,
    ...bmsInboxResolvers.Mutation,
    ...bmsAssistantResolvers.Mutation,
    ...bmsStoreProfileResolvers.Mutation,
    ...bmsCouponsResolvers.Mutation,
    ...bmsReportScheduleResolvers.Mutation,
    ...bmsRestockSubscriptionsResolvers.Mutation,
  },
  BmsOrder: bmsOrdersResolvers.BmsOrder,
  BmsOrderItem: bmsOrdersResolvers.BmsOrderItem,
  BmsProduct: bmsProductsResolvers.BmsProduct,
  BmsCustomer: bmsCustomersResolvers.BmsCustomer,
  BmsPurchaseOrder: bmsPurchaseResolvers.BmsPurchaseOrder,
  BmsPayment: bmsPaymentsResolvers.BmsPayment,
  BmsShipment: bmsShippingResolvers.BmsShipment,
  BmsConversation: bmsInboxResolvers.BmsConversation,
  BmsConversationNote: bmsInboxResolvers.BmsConversationNote,
  BmsAuditEntry: bmsDashboardResolvers.BmsAuditEntry,
};

export const resolvers = {
  ...rawResolvers,
  Query: wrapResolverMap("Query", rawResolvers.Query as unknown as Record<string, unknown>),
  Mutation: wrapResolverMap("Mutation", rawResolvers.Mutation as unknown as Record<string, unknown>),
};
