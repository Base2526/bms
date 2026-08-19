// apps/web/app/api/auth/logout/route.ts
import { NextResponse } from "next/server";
import { USER_COOKIE } from "@/lib/auth/token";
import { withRouteErrorLog } from "@/lib/log/routeError";

const isDev = process.env.NODE_ENV !== "production";
const useSecureCookie = process.env.COOKIE_SECURE === "true";

async function handlePOST() {
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
