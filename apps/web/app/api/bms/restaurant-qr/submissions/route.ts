import { NextResponse, type NextRequest } from "next/server";
import {
  getRestaurantQrSubmissionStatus,
  submitRestaurantQrOrder,
} from "@/lib/bms/restaurantQrOrdering";
import { withRouteErrorLog } from "@/lib/log/routeError";
import {
  requireRestaurantQrRateLimit,
  restaurantQrError,
  restaurantQrPublicToken,
  restaurantQrSessionToken,
} from "../routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const limited = await requireRestaurantQrRateLimit(req, "status", 60);
  if (limited) return limited;
  try {
    return NextResponse.json(await getRestaurantQrSubmissionStatus(
      restaurantQrSessionToken(req),
      restaurantQrPublicToken(req)
    ));
  } catch (error) {
    return restaurantQrError(error);
  }
}

async function handlePOST(req: NextRequest) {
  const limited = await requireRestaurantQrRateLimit(req, "submit", 10);
  if (limited) return limited;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const result = await submitRestaurantQrOrder({
      sessionToken: restaurantQrSessionToken(req),
      publicToken: restaurantQrPublicToken(req),
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
      items: Array.isArray(body.items) ? body.items as any[] : [],
    });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return restaurantQrError(error);
  }
}

export const GET = withRouteErrorLog("GET /api/bms/restaurant-qr/submissions", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/restaurant-qr/submissions", handlePOST);
