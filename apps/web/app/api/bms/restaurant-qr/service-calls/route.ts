import { NextResponse, type NextRequest } from "next/server";
import {
  createRestaurantServiceCall,
  getRestaurantServiceCallsForGuest,
} from "@/lib/bms/restaurantServiceCalls";
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
  const limited = await requireRestaurantQrRateLimit(req, "service-call-status", 60);
  if (limited) return limited;
  try {
    return NextResponse.json(await getRestaurantServiceCallsForGuest(
      restaurantQrSessionToken(req), restaurantQrPublicToken(req)
    ));
  } catch (error) {
    return restaurantQrError(error);
  }
}

async function handlePOST(req: NextRequest) {
  const limited = await requireRestaurantQrRateLimit(req, "service-call-submit", 6);
  if (limited) return limited;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const result = await createRestaurantServiceCall({
      sessionToken: restaurantQrSessionToken(req),
      publicToken: restaurantQrPublicToken(req),
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
      requestCode: typeof body.requestCode === "string" ? body.requestCode : "",
      requestNote: typeof body.requestNote === "string" ? body.requestNote : null,
    });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return restaurantQrError(error);
  }
}

export const GET = withRouteErrorLog("GET /api/bms/restaurant-qr/service-calls", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/restaurant-qr/service-calls", handlePOST);
