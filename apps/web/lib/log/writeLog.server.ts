// apps/web/lib/log/writeLog.server.ts
import "server-only";

import type { LogLevel, LogMeta } from "./types";
import { query } from "@/lib/db";
import { maybeAlertSlackForLog } from "./alertSlackServer";

function isPlainObject(v: unknown): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

const SENSITIVE_KEY = /(authorization|cookie|token|secret|password|passcode|pin|api[_-]?key|card|account|raw|payload|request|response|body|note|address|phone)/i;
const SENSITIVE_TEXT = /(Bearer\s+[A-Za-z0-9._~+\/-]+=*|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g;

function redactDeep(value: any, depth = 0, parentKey = ""): any {
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const limit = /stack/i.test(parentKey) ? 12_000 : 2_000;
    return value.replace(SENSITIVE_TEXT, "[REDACTED]").slice(0, limit);
  }
  if (depth >= 5) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactDeep(item, depth + 1, parentKey));
  if (!isPlainObject(value)) return String(value).slice(0, 500);

  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(value).slice(0, 100)) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = "[REDACTED]";
      continue;
    }
    out[k] = redactDeep(v, depth + 1, k);
  }
  return out;
}

function pickString(meta: LogMeta, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = (meta as any)?.[key];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

function pickInt(meta: LogMeta, ...keys: string[]): number | null {
  for (const key of keys) {
    const v = (meta as any)?.[key];
    if (v === null || v === undefined) continue;
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

let structuredColsReady: boolean | null = null;
let tenantColReady: boolean | null = null;
async function ensureStructuredColsReady() {
  if (structuredColsReady !== null) return structuredColsReady;
  try {
    const { rows } = await query<{ exists: boolean }>(
      `SELECT EXISTS(
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'system_logs'
          AND column_name = 'action'
      ) AS exists`
    );
    structuredColsReady = !!rows?.[0]?.exists;
  } catch {
    structuredColsReady = false;
  }
  return structuredColsReady;
}

async function ensureTenantColReady() {
  if (tenantColReady !== null) return tenantColReady;
  try {
    const { rows } = await query<{ exists: boolean }>(
      `SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'system_logs' AND column_name = 'tenant_id'
      ) AS exists`
    );
    tenantColReady = !!rows?.[0]?.exists;
  } catch { tenantColReady = false; }
  return tenantColReady;
}

export async function writeLogServer(
  level: LogLevel,
  category: string,
  message: string,
  meta: LogMeta = {}
) {
  // Never crash application flows due to logging.
  try {
    const metaRedacted = redactDeep(meta ?? {});
    const safeCategory = String(redactDeep(String(category), 0, "category")).slice(0, 80);
    const safeMessage = String(redactDeep(String(message), 0, "message")).slice(0, 2_000);

    const action = pickString(metaRedacted, "action", "event")?.slice(0, 120) ?? null;
    const status = pickString(metaRedacted, "status")?.slice(0, 60) ?? null;
    const correlation_id = pickString(metaRedacted, "correlationId", "correlation_id")?.slice(0, 160) ?? null;
    const session_id = pickString(metaRedacted, "sessionId", "session_id")?.slice(0, 160) ?? null;
    const screen_name = pickString(metaRedacted, "screenName", "screen_name")?.slice(0, 300) ?? null;
    const route_name = pickString(metaRedacted, "routeName", "route_name")?.slice(0, 300) ?? null;
    const platform = pickString(metaRedacted, "platform")?.slice(0, 80) ?? null;
    const app_version = pickString(metaRedacted, "appVersion", "app_version")?.slice(0, 80) ?? null;
    const duration_ms = pickInt(metaRedacted, "durationMs", "duration_ms");
    const error_message = pickString(metaRedacted, "errorMessage", "error_message")?.slice(0, 2_000) ?? null;
    const stack = pickString(metaRedacted, "stack")?.slice(0, 12_000) ?? null;
    const device_info = (metaRedacted as any)?.deviceInfo ?? (metaRedacted as any)?.device_info ?? null;
    const created_by_raw = (metaRedacted as any)?.userId ?? (metaRedacted as any)?.user_id ?? null;
    const created_by =
      typeof created_by_raw === "number"
        ? created_by_raw
        : created_by_raw
          ? parseInt(String(created_by_raw), 10) || null
          : null;
    const tenant_id = pickString(metaRedacted, "tenantId", "tenant_id");

    const hasStructured = await ensureStructuredColsReady();
    const hasTenant = await ensureTenantColReady();

    if (hasStructured) {
      const columns = `level, category, message, meta, created_by,
          action, status, correlation_id, session_id,
          screen_name, route_name, platform, app_version,
          duration_ms, error_message, stack, device_info${hasTenant ? ", tenant_id" : ""}`;
      const values = [
        level, safeCategory, safeMessage, JSON.stringify(metaRedacted ?? {}), created_by,
        action, status, correlation_id, session_id, screen_name, route_name, platform,
        app_version, duration_ms, error_message, stack,
        device_info ? JSON.stringify(device_info) : null,
        ...(hasTenant ? [tenant_id] : []),
      ];
      await query(
        `INSERT INTO system_logs(
          ${columns}
        ) VALUES (${values.map((_, index) => `$${index + 1}`).join(",")})`,
        values
      );
    } else {
      await query(
        `INSERT INTO system_logs(level, category, message, meta, created_by)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          level,
          safeCategory,
          safeMessage,
          JSON.stringify(metaRedacted ?? {}),
          created_by,
        ]
      );
    }

    if (process.env.NODE_ENV !== "production") {
      const payload = {
        level,
        category: safeCategory,
        message: safeMessage,
        action,
        status,
        correlation_id,
        session_id,
      };
      if (level === "error") console.error("[LOG]", payload);
      else if (level === "warn") console.warn("[LOG]", payload);
      else console.log("[LOG]", payload);
    }

    if (String(level).toLowerCase() === "error") {
      void maybeAlertSlackForLog({
        level,
        action,
        category: safeCategory,
        message: safeMessage,
        error_message,
        platform,
        app_version,
        created_by,
        correlation_id,
        session_id,
      });
    }

    return true;
  } catch (err) {
    console.error("[writeLogServer] failed", err);
    return false;
  }
}
