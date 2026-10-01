import { parse as parseCookieHeader } from "cookie";

import { ADMIN_COOKIE, verifyTokenString } from "@/lib/auth/token";
import { query } from "@/lib/db";

// Do not add `import "server-only"` here. This helper is consumed by a Pages
// API route so it can authenticate the raw IncomingMessage without buffering a
// multi-gigabyte upload. Next's `server-only` marker is supported by the App
// Router compiler, but its runtime package deliberately throws when bundled by
// the legacy Pages API compiler. The Node-only filename and imports keep this
// module out of client code while allowing that streaming route to start.

export type PlatformAdminNodeAuth =
  | { ok: true; adminId: string | number }
  | { ok: false; status: 401 | 403 };

/**
 * Authenticate the raw Node request used by the bulk upload endpoint. This
 * deliberately does not import `next/headers`: doing so would put the request
 * back through the NextRequest path whose body buffering this endpoint avoids.
 */
export async function authorizePlatformAdminCookieHeader(
  rawCookieHeader: string | undefined
): Promise<PlatformAdminNodeAuth> {
  let token: string | undefined;
  try {
    token = parseCookieHeader(rawCookieHeader || "")[ADMIN_COOKIE];
  } catch {
    return { ok: false, status: 401 };
  }

  const admin = verifyTokenString(token);
  if (!admin?.role) return { ok: false, status: 401 };

  try {
    const result = await query<{ is_platform_admin: boolean }>(
      `SELECT is_platform_admin FROM users WHERE id = $1`,
      [admin.id]
    );
    return result.rows[0]?.is_platform_admin === true
      ? { ok: true, adminId: admin.id }
      : { ok: false, status: 403 };
  } catch {
    return { ok: false, status: 403 };
  }
}
