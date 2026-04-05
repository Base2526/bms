// /apps/web/lib/log/log.ts
// Client-safe logging helper: sends logs to /api/logs.
// IMPORTANT: Do not import server-only modules from here.

export type { LogLevel, LogMeta } from "./types";
import type { LogLevel, LogMeta } from "./types";

function getApiBaseUrl() {
  // On the browser we can use relative URL.
  if (typeof window !== "undefined") return process.env.NEXT_PUBLIC_BASE_URL || "";

  // On the server, Node's fetch requires an absolute URL.
  const raw =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    process.env.VERCEL_URL ||
    process.env.NEXT_PUBLIC_VERCEL_URL ||
    "";

  if (raw) return raw.startsWith("http") ? raw : `https://${raw}`;

  const port = process.env.PORT || "3000";
  return `http://localhost:${port}`;
}

/**
 * ✅ Global helper สำหรับส่ง log ไป backend /api/logs
 * - ใช้ในทั้ง client และ server component ได้
 * - category = หมวดของ log (เช่น "auth", "user", "payment")
 * - message  = ข้อความหลัก
 * - meta     = object เพิ่มเติม เช่น { userId, ip, error }
 */
export async function addLog(
  level: LogLevel,
  category: string,
  message: string,
  meta: LogMeta = {}
) {
  try {
    const body = JSON.stringify({ level, category, message, meta });

    const baseUrl = getApiBaseUrl();

    // Client: relative works. Server: baseUrl ensures absolute URL.
    const res = await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!res.ok) {
      console.error(`[addLog] failed: ${res.status}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[addLog] error', err);
    return false;
  }
}
