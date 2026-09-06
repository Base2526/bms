import { NextResponse, type NextRequest } from "next/server";
import { getRestaurantQrMenuItem } from "@/lib/bms/restaurantQrOrdering";
import { withRouteErrorLog } from "@/lib/log/routeError";
import {
  requireRestaurantQrRateLimit,
  restaurantQrError,
  restaurantQrPublicToken,
  restaurantQrSessionToken,
} from "../routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const limited = await requireRestaurantQrRateLimit(req, "menu-item", 60);
  if (limited) return limited;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    return NextResponse.json(await getRestaurantQrMenuItem({
      sessionToken: restaurantQrSessionToken(req),
      publicToken: restaurantQrPublicToken(req),
      sku: typeof body.sku === "string" ? body.sku.trim() : "",
      size: typeof body.size === "string" ? body.size : null,
      packCode: typeof body.packCode === "string" ? body.packCode : null,
    }));
  } catch (error) {
    return restaurantQrError(error);
  }
}

export const POST = withRouteErrorLog("POST /api/bms/restaurant-qr/menu-item", handlePOST);
