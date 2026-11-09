import { NextResponse, type NextRequest } from "next/server";
import {
  getPickupQueueBoardSettings,
  issuePickupQueueNumber,
  listPickupQueue,
  listPickupQueueBoard,
  listPickupQueueDay,
  PICKUP_QUEUE_ACTIONS,
  PickupQueueError,
  updatePickupQueueEntry,
  type PickupQueueAction,
} from "@/lib/bms/pickupQueue";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { authenticateRestaurantMutation, authenticateRestaurantRead } from "../restaurant/routeAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pickup queue numbers (`10.111`) — device Bearer only, never public.
 *
 * `?view=board` is what the customer-facing call screen polls: numbers and status only, no
 * order id. The cashier panel gets the entry ids it needs to call/collect.
 */
async function handleGET(req: NextRequest) {
  const auth = await authenticateRestaurantRead(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const headers = { "Cache-Control": "no-store" };
  // `?view=day`: the staff manager — every number of today including collected/cancelled.
  if (req.nextUrl.searchParams.get("view") === "day") {
    const [day, settings] = await Promise.all([
      listPickupQueueDay(auth.device.tenantId, auth.device.locationId),
      getPickupQueueBoardSettings(auth.device.tenantId, auth.device.locationId),
    ]);
    return NextResponse.json({ entries: day, settings, serverTime: new Date().toISOString() }, { headers });
  }
  if (req.nextUrl.searchParams.get("view") === "board") {
    const board = await listPickupQueueBoard(auth.device.tenantId, auth.device.locationId);
    return NextResponse.json({ ...board, serverTime: new Date().toISOString() }, { headers });
  }
  const [entries, settings] = await Promise.all([
    listPickupQueue(auth.device.tenantId, auth.device.locationId),
    getPickupQueueBoardSettings(auth.device.tenantId, auth.device.locationId),
  ]);
  return NextResponse.json({ entries, settings, serverTime: new Date().toISOString() }, { headers });
}

async function handlePOST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // Same gate as the table waitlist: no action here moves money or stock.
  const auth = await authenticateRestaurantMutation(req, body, "pos.sell");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const action = String(body.action ?? "").trim().toLowerCase();
  try {
    if (action === "issue") {
      // Retry path for a sale whose number could not be issued at checkout.
      const orderId = String(body.orderId ?? "").trim();
      if (!orderId) return NextResponse.json({ error: "ไม่ได้ระบุบิล" }, { status: 400 });
      const entry = await issuePickupQueueNumber({
        tenantId: auth.device.tenantId,
        locationId: auth.device.locationId,
        deviceId: auth.device.id,
        orderId,
        actorUserId: auth.actor.userId,
      });
      return NextResponse.json({ entry });
    }
    if (!PICKUP_QUEUE_ACTIONS.includes(action as PickupQueueAction)) {
      return NextResponse.json({ error: "คำสั่งคิวไม่ถูกต้อง" }, { status: 400 });
    }
    const entryId = String(body.entryId ?? "").trim();
    if (!entryId) return NextResponse.json({ error: "ไม่ได้ระบุคิว" }, { status: 400 });
    const entry = await updatePickupQueueEntry({
      tenantId: auth.device.tenantId,
      locationId: auth.device.locationId,
      entryId,
      action: action as PickupQueueAction,
      actorUserId: auth.actor.userId,
    });
    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof PickupQueueError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    // Malformed uuid from the client, not a server fault.
    if ((error as { code?: string })?.code === "22P02") {
      return NextResponse.json({ error: "ไม่พบคิวนี้" }, { status: 404 });
    }
    throw error;
  }
}

export const GET = withRouteErrorLog("GET /api/pos/pickup-queue", handleGET);
export const POST = withRouteErrorLog("POST /api/pos/pickup-queue", handlePOST);
