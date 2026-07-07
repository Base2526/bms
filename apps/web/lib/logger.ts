import { query } from "@/lib/db";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogPayload = {
  level: LogLevel;
  category: string;
  message: string;
  meta?: unknown;
  at: string;
};

const DEFAULT_DB_LEVELS: ReadonlySet<LogLevel> = new Set(["error", "warn", "info"]);

function parseDbLogLevels(): ReadonlySet<LogLevel> {
  const raw = process.env.DB_LOG_LEVELS;
  if (!raw || !raw.trim()) return DEFAULT_DB_LEVELS;

  const allowed: ReadonlySet<string> = new Set(["debug", "info", "warn", "error"]);
  const values = raw
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
    .filter((v) => allowed.has(v));

  const set = new Set<LogLevel>();
  for (const v of values) {
    set.add(v as LogLevel);
  }
  return set.size ? set : DEFAULT_DB_LEVELS;
}

function serializeForConsole(payload: LogPayload): void {
  try {
    console.log(JSON.stringify(payload));
  } catch (err) {
    // Must never break API execution
    const fallback: LogPayload = {
      level: "error",
      category: "logger",
      message: "failed to serialize log payload",
      meta: {
        original_level: payload.level,
        original_category: payload.category,
        original_message: payload.message,
        meta_type: typeof payload.meta,
        error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
      },
      at: new Date().toISOString(),
    };
    try {
      console.log(JSON.stringify(fallback));
    } catch {
      // Last resort
      console.error("[logger] failed to serialize fallback payload");
    }
  }
}

function safeMeta(meta: unknown): unknown {
  if (meta === undefined) return undefined;
  if (meta instanceof Error) {
    return { name: meta.name, message: meta.message };
  }

  // Ensure JSON-serializable; if not, stringify best-effort.
  try {
    JSON.stringify(meta);
    return meta;
  } catch {
    return { value: String(meta) };
  }
}

export async function writeLogToDb(payload: LogPayload): Promise<void> {
  const enableDbLog = process.env.DB_LOG === "true";
  if (!enableDbLog) return;

  const dbLevels = parseDbLogLevels();
  // console.debug("[writeLogToDb] payload:", payload, "dbLevels:", dbLevels);
  if (!dbLevels.has(payload.level)) return;
  try {
    const metaJson = payload.meta === undefined ? null : JSON.stringify(safeMeta(payload.meta));
    await query(
      `INSERT INTO public.system_logs(level, category, message, meta, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)`,
      [payload.level, payload.category, payload.message, metaJson, payload.at]
    );
  } catch (err) {
    const fallback: LogPayload = {
      level: "error",
      category: "logger",
      message: "failed to persist log to db",
      meta: safeMeta({ original: payload, error: err instanceof Error ? { name: err.name, message: err.message } : String(err) }),
      at: new Date().toISOString(),
    };
    serializeForConsole(fallback);
  }
}

/**
 * JSON console logger for Docker/stdout aggregation.
 * DEBUG_LOG=false suppresses debug level.
 */
export const log = (
  level: LogLevel,
  category: string,
  message: string,
  meta?: unknown
) => {
  const isDebug = process.env.DEBUG_LOG === "true";
  if (level === "debug" && !isDebug) return;

  const payload: LogPayload = {
    level,
    category,
    message,
    ...(meta === undefined ? {} : { meta }),
    at: new Date().toISOString(),
  };

  // Important: console.log -> captured by docker logs / k8s
  serializeForConsole(payload);
};

/**
 * Console + optional DB logging (DB_LOG=true).
 * Safe to call without awaiting; never throws.
 */
export async function logAsync(
  level: LogLevel,
  category: string,
  message: string,
  meta?: unknown
): Promise<void> {
  // Keep console behavior unchanged: same JSON shape as log()
  const isDebug = process.env.DEBUG_LOG === "true";
  if (level === "debug" && !isDebug) return;

  const payload: LogPayload = {
    level,
    category,
    message,
    ...(meta === undefined ? {} : { meta }),
    at: new Date().toISOString(),
  };

  serializeForConsole(payload);

  // Fire-and-forget DB write (won't throw)
  void writeLogToDb({
    ...payload,
    ...(meta === undefined ? {} : { meta: safeMeta(meta) }),
  });
}

export async function syslog(message:string, opts?: {
  level?: LogLevel,
  category?: string,
  meta?: unknown,
  user_id?: number|null,
}){
  const level = opts?.level || "info";
  const category = opts?.category || "app";
  const meta = opts?.meta || {};
  const user_id = opts?.user_id ?? null;
  try{
    await query(
      `INSERT INTO system_logs(level, category, message, meta, created_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [ level, category, message, JSON.stringify(meta), user_id ]
    );
  }catch(e){
    console.error("[syslog insert failed]", e);
  }
}
