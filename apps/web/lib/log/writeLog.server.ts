// apps/web/lib/log/writeLog.server.ts
import "server-only";

import type { LogLevel, LogMeta } from "./types";
import { query } from "@/lib/db";
import { maybeAlertSlackForLog } from "./alertSlackServer";
import { sanitizeLogText, sanitizeLogValue } from "./sanitize";

function pickString(meta: LogMeta, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = (meta as any)?.[key];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s && s !== "[REDACTED]") return s;
  }
  return null;
}

function pickInt(meta: LogMeta, ...keys: string[]): number | null {
  for (const key of keys) {
    const v = (meta as any)?.[key];
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && !v.trim()) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0 && n <= 2_147_483_647) return Math.trunc(n);
  }
  return null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOrNull(value: string | null): string | null {
  return value && UUID_PATTERN.test(value) ? value : null;
}

function legacyActorId(meta: LogMeta): number | null {
  const value = meta?.userId ?? meta?.user_id;
  if (typeof value === "string" && !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return value != null && Number.isSafeInteger(number) && number >= 0 && number <= 2_147_483_647
    ? number : null;
}

let structuredColsReady: { value: boolean; checkedAt: number } | null = null;
let tenantColReady: { value: boolean; checkedAt: number } | null = null;
const COLUMN_CACHE_MS = 60_000;
async function ensureStructuredColsReady() {
  if (structuredColsReady && Date.now() - structuredColsReady.checkedAt < COLUMN_CACHE_MS) return structuredColsReady.value;
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
    structuredColsReady = { value: !!rows?.[0]?.exists, checkedAt: Date.now() };
  } catch {
    structuredColsReady = { value: false, checkedAt: Date.now() };
  }
  return structuredColsReady.value;
}

async function ensureTenantColReady() {
  if (tenantColReady && Date.now() - tenantColReady.checkedAt < COLUMN_CACHE_MS) return tenantColReady.value;
  try {
    const { rows } = await query<{ exists: boolean }>(
      `SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'system_logs' AND column_name = 'tenant_id'
      ) AS exists`
    );
    tenantColReady = { value: !!rows?.[0]?.exists, checkedAt: Date.now() };
  } catch { tenantColReady = { value: false, checkedAt: Date.now() }; }
  return tenantColReady.value;
}

export async function writeLogServer(
  level: LogLevel,
  category: string,
  message: string,
  meta: LogMeta = {},
  options: { alert?: boolean } = {}
) {
  // Never crash application flows due to logging.
  try {
    const metaRedacted = sanitizeLogValue(meta ?? {}) as LogMeta;
    const serializedMeta = JSON.stringify(metaRedacted ?? {});
    const storedMeta = Buffer.byteLength(serializedMeta, "utf8") <= 64 * 1024
      ? serializedMeta
      : JSON.stringify({ truncated: true, keys: Object.keys(metaRedacted ?? {}).slice(0, 30) });
    const safeCategory = sanitizeLogText(category, 80);
    const safeMessage = sanitizeLogText(message);

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
    const deviceJson = device_info ? JSON.stringify(device_info) : null;
    const storedDeviceInfo = deviceJson && Buffer.byteLength(deviceJson, "utf8") <= 16 * 1024
      ? deviceJson : deviceJson ? JSON.stringify({ truncated: true }) : null;
    const created_by = legacyActorId(metaRedacted);
    // From the unredacted meta: a tenant id is an identifier, not PII, and the sanitizer masks long
    // digit runs — DEFAULT_TENANT_ID became "11111111-1111-1111-1111-[NUMBER]", the uuid INSERT
    // failed and the log was lost. Anything that is not a UUID is stored as NULL.
    const tenant_id = uuidOrNull(pickString(meta ?? {}, "tenantId", "tenant_id"));

    const hasStructured = await ensureStructuredColsReady();
    const hasTenant = await ensureTenantColReady();

    if (hasStructured) {
      const columns = `level, category, message, meta, created_by,
          action, status, correlation_id, session_id,
          screen_name, route_name, platform, app_version,
          duration_ms, error_message, stack, device_info${hasTenant ? ", tenant_id" : ""}`;
      const values = [
        level, safeCategory, safeMessage, storedMeta, created_by,
        action, status, correlation_id, session_id, screen_name, route_name, platform,
        app_version, duration_ms, error_message, stack,
        storedDeviceInfo,
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
          storedMeta,
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

    if (options.alert !== false && String(level).toLowerCase() === "error") {
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
    console.error("[writeLogServer] failed", sanitizeLogValue(err));
    return false;
  }
}
