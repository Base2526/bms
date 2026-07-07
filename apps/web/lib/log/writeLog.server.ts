// apps/web/lib/log/writeLog.server.ts
import "server-only";

import type { LogLevel, LogMeta } from "./types";
import { query } from "@/lib/db";
import { maybeAlertSlackForLog } from "./alertSlackServer";

function isPlainObject(v: unknown): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

const SENSITIVE_KEYS = new Set([
  "authorization",
  "token",
  "access_token",
  "refresh_token",
  "password",
  "pass",
  "secret",
  "api_key",
  "apikey",
]);

function redactDeep(value: any): any {
  if (Array.isArray(value)) return value.map(redactDeep);
  if (!isPlainObject(value)) return value;

  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(value)) {
    const keyLower = String(k).toLowerCase();
    if (SENSITIVE_KEYS.has(keyLower)) {
      out[k] = "[REDACTED]";
      continue;
    }
    out[k] = redactDeep(v);
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

export async function writeLogServer(
  level: LogLevel,
  category: string,
  message: string,
  meta: LogMeta = {}
) {
  // Never crash application flows due to logging.
  try {
    const metaRedacted = redactDeep(meta ?? {});

    const action = pickString(metaRedacted, "action", "event");
    const status = pickString(metaRedacted, "status");
    const correlation_id = pickString(metaRedacted, "correlationId", "correlation_id");
    const session_id = pickString(metaRedacted, "sessionId", "session_id");
    const screen_name = pickString(metaRedacted, "screenName", "screen_name");
    const route_name = pickString(metaRedacted, "routeName", "route_name");
    const platform = pickString(metaRedacted, "platform");
    const app_version = pickString(metaRedacted, "appVersion", "app_version");
    const duration_ms = pickInt(metaRedacted, "durationMs", "duration_ms");
    const error_message = pickString(metaRedacted, "errorMessage", "error_message");
    const stack = pickString(metaRedacted, "stack");
    const device_info = (metaRedacted as any)?.deviceInfo ?? (metaRedacted as any)?.device_info ?? null;
    const created_by_raw = (metaRedacted as any)?.userId ?? (metaRedacted as any)?.user_id ?? null;
    const created_by =
      typeof created_by_raw === "number"
        ? created_by_raw
        : created_by_raw
          ? parseInt(String(created_by_raw), 10) || null
          : null;

    const hasStructured = await ensureStructuredColsReady();

    if (hasStructured) {
      await query(
        `INSERT INTO system_logs(
          level, category, message, meta, created_by,
          action, status, correlation_id, session_id,
          screen_name, route_name, platform, app_version,
          duration_ms, error_message, stack, device_info
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          level,
          category,
          message,
          JSON.stringify(metaRedacted ?? {}),
          created_by,
          action,
          status,
          correlation_id,
          session_id,
          screen_name,
          route_name,
          platform,
          app_version,
          duration_ms,
          error_message,
          stack,
          device_info ? JSON.stringify(device_info) : null,
        ]
      );
    } else {
      await query(
        `INSERT INTO system_logs(level, category, message, meta, created_by)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          level,
          category,
          message,
          JSON.stringify(metaRedacted ?? {}),
          created_by,
        ]
      );
    }

    if (process.env.NODE_ENV !== "production") {
      const payload = {
        level,
        category,
        message,
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
        category,
        message,
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
