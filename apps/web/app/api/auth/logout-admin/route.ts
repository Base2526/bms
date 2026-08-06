// apps/web/app/api/auth/logout-admin/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, verifyTokenString } from "@/lib/auth/token";
import { revokeAdminSession } from "@/lib/redisSession";

const isProd = process.env.NODE_ENV === "production";
export async function POST() {

  console.log("[ADMIN_COOKIE] POST");

  // Revoke the Redis session (lib/redisSession.ts) so this token stops working
  // immediately, not just once its own `exp` arrives. Best-effort: a decode/Redis
  // failure here must not block logout — the cookie clear below still happens.
  try {
    const payload = verifyTokenString(cookies().get(ADMIN_COOKIE)?.value);
    if (payload?.jti) await revokeAdminSession(payload.jti);
  } catch (err: any) {
    console.error("[logout-admin] session revoke failed (ignored)", err?.message ?? err);
  }

  const res = NextResponse.json({ ok: true, message: "Admin logged out" });
  res.cookies.set(ADMIN_COOKIE, "", {
    path: "/", 
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    expires: new Date(0),
    maxAge: 0,
  });
  return res;
}
