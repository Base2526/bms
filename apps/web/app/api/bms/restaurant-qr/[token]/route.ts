import { NextResponse, type NextRequest } from "next/server";
import {
  openRestaurantQrSession,
  RESTAURANT_QR_SESSION_COOKIE,
  RESTAURANT_QR_SESSION_MAX_AGE_SECONDS,
} from "@/lib/bms/restaurantQrOrdering";
import { withRouteErrorLog } from "@/lib/log/routeError";
import {
  requireRestaurantQrRateLimit,
  restaurantQrError,
  restaurantQrSessionToken,
} from "../routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: { token: string } };

async function handleGET(req: NextRequest, { params }: RouteContext) {
  const limited = await requireRestaurantQrRateLimit(req, "open", 30);
  if (limited) return limited;
  try {
    const result = await openRestaurantQrSession(params.token, restaurantQrSessionToken(req));
    const { sessionToken, ...body } = result as typeof result & { sessionToken?: string };
    const response = NextResponse.json(body, { status: result.status === "INVALID_QR" ? 404 : 200 });
    if (result.status === "READY" && sessionToken) {
      response.cookies.set(RESTAURANT_QR_SESSION_COOKIE, sessionToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: RESTAURANT_QR_SESSION_MAX_AGE_SECONDS,
      });
    }
    return response;
  } catch (error) {
    return restaurantQrError(error);
  }
}

export const GET = withRouteErrorLog("GET /api/bms/restaurant-qr/[token]", handleGET);
