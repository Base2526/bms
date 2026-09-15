import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";

import {
  verifyAdminFromRequest,
  verifyAdminSession,
  verifyUserFromRequest,
  verifyUserSession,
} from "@/lib/auth/server";
import { ACT_TENANT_COOKIE, verifyActTenant } from "@/lib/auth/token";
import { mintAdminRealtimeTicket, mintPosRealtimeTicket, mintUserRealtimeTicket } from "@/lib/bms/realtimeAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const requestedScope = (req.nextUrl.searchParams.get("scope") || "web").toLowerCase();
  if (!(["admin", "web", "android", "pos"] as string[]).includes(requestedScope)) {
    return NextResponse.json({ error: "INVALID_REALTIME_SCOPE" }, { status: 400 });
  }

  const authorization = req.headers.get("authorization") ?? "";
  const bearerToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";

  const issued = requestedScope === "admin"
    ? await mintAdminRealtimeTicket(
      verifyAdminSession() ?? verifyAdminFromRequest(req),
      verifyActTenant(cookies().get(ACT_TENANT_COOKIE)?.value),
    )
    : requestedScope === "pos"
      ? await mintPosRealtimeTicket(bearerToken || req.headers.get("x-pos-device-token")?.trim() || "")
      : await mintUserRealtimeTicket(
      requestedScope as "web" | "android",
      requestedScope === "android" ? verifyUserFromRequest(req) : verifyUserSession(),
    );

  if (!issued) {
    return NextResponse.json({ error: "REALTIME_AUTHENTICATION_FAILED" }, { status: 401 });
  }
  return NextResponse.json(issued, {
    headers: { "Cache-Control": "no-store, private" },
  });
}

export const POST = withRouteErrorLog("POST /api/bms/realtime/ticket", handlePOST);
