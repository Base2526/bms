import { NextResponse, type NextRequest } from "next/server";
import { getRestaurantQrMenu } from "@/lib/bms/restaurantQrOrdering";
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
  const limited = await requireRestaurantQrRateLimit(req, "menu", 60);
  if (limited) return limited;
  try {
    return NextResponse.json(await getRestaurantQrMenu(
      restaurantQrSessionToken(req),
      restaurantQrPublicToken(req)
    ));
  } catch (error) {
    return restaurantQrError(error);
  }
}

export const GET = withRouteErrorLog("GET /api/bms/restaurant-qr/menu", handleGET);
