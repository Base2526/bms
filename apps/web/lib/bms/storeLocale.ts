import "server-only";

import { query } from "@/lib/db";

export const DEFAULT_STORE_TIMEZONE = "Asia/Bangkok";

export function isValidTimeZone(value: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0)); return true; }
  catch { return false; }
}

/** A read failure is non-fatal for operational reports; Thai legacy behaviour is the fallback. */
export async function resolveStoreTimezone(tenantId: string): Promise<string> {
  try {
    const result = await query<{ timezone: string | null }>(
      `SELECT COALESCE(to_jsonb(sp)->>'timezone_code',sp.timezone) AS timezone
         FROM bms_store_profile sp WHERE tenant_id=$1`,[tenantId]);
    const value = result.rows[0]?.timezone?.trim();
    return value && isValidTimeZone(value) ? value : DEFAULT_STORE_TIMEZONE;
  } catch { return DEFAULT_STORE_TIMEZONE; }
}
