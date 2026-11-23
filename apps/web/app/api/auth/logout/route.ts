// apps/web/app/api/auth/logout/route.ts
import { NextResponse } from "next/server";
import { USER_COOKIE, verifyTokenString } from "@/lib/auth/token";
import { cookies } from "next/headers";
import { query } from "@/lib/db";
import { recordSecurityEventBestEffort } from "@/lib/bms/securityEvents";
import { withRouteErrorLog } from "@/lib/log/routeError";

const isDev = process.env.NODE_ENV !== "production";
const useSecureCookie = process.env.COOKIE_SECURE === "true";

async function handlePOST() {
  try {
    const payload = verifyTokenString((await cookies()).get(USER_COOKIE)?.value);
    if (payload) {
      const account = await query<{ tenant_id: string | null }>(
        "SELECT tenant_id FROM users WHERE id = $1", [payload.id]
      );
      await recordSecurityEventBestEffort({
        tenantId: account.rows[0]?.tenant_id ?? null,
        actorUserId: String(payload.id),
        event: "auth.logout",
        outcome: "SUCCESS",
        source: "USER_COOKIE",
      });
    }
  } catch (error) {
    console.error("[logout] security event failed (ignored)", error instanceof Error ? error.name : "unknown");
  }
  const res = NextResponse.json({ ok: true, message: "User logged out" });

  res.cookies.set(USER_COOKIE, "", {
    path: "/",
    httpOnly: true,
    secure: useSecureCookie && !isDev,
    sameSite: "lax",
    maxAge: 0, // ลบ cookie ทันที
  });

  return res;
}

export const POST = withRouteErrorLog("POST /api/auth/logout", handlePOST);
