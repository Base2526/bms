import { NextResponse, type NextRequest } from "next/server";
import {
  getPickupQueueBoardSettings,
  findPickupQueueDayNumber,
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
import { EMPTY_QUEUE_BOARD_MEDIA, getQueueBoardMedia } from "@/lib/bms/queueBoardMedia";
import { authenticateRestaurantMutation, authenticateRestaurantRead } from "../restaurant/routeAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  // `?view=day`: up to 500 staff rows, open first; queueNo looks up any service-day number.
  if (req.nextUrl.searchParams.get("view") === "day") {
    const requestedNo = req.nextUrl.searchParams.get("queueNo");
    if (requestedNo !== null) {
      if (!/^[1-9][0-9]{0,3}$/.test(requestedNo)) {
        return NextResponse.json({ error: "เลขคิวไม่ถูกต้อง" }, { status: 400, headers });
      }
      const entry = await findPickupQueueDayNumber(
        auth.device.tenantId, auth.device.locationId, Number(requestedNo)
      );
      return NextResponse.json({ entries: entry ? [entry] : [], serverTime: new Date().toISOString() }, { headers });
    }
    const [day, settings] = await Promise.all([
      listPickupQueueDay(auth.device.tenantId, auth.device.locationId),
      getPickupQueueBoardSettings(auth.device.tenantId, auth.device.locationId),
    ]);
    return NextResponse.json({ entries: day, settings, serverTime: new Date().toISOString() }, { headers });
  }
  if (req.nextUrl.searchParams.get("view") === "board") {
    const [board, media] = await Promise.all([
      listPickupQueueBoard(auth.device.tenantId, auth.device.locationId),
      // A missing/failed presentation migration must never take the queue off screen.
      getQueueBoardMedia(auth.device.tenantId, auth.device.locationId).catch(() => EMPTY_QUEUE_BOARD_MEDIA),
    ]);
    return NextResponse.json({ ...board, media, serverTime: new Date().toISOString() }, { headers });
  }
  const [entries, settings] = await Promise.all([
    listPickupQueue(auth.device.tenantId, auth.device.locationId),
    getPickupQueueBoardSettings(auth.device.tenantId, auth.device.locationId),
  ]);
  return NextResponse.json({ entries, settings, serverTime: new Date().toISOString() }, { headers });
}

async function handlePOST(req: NextRequest) {
  const parsed: unknown = await req.json().catch(() => null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ error: "คำขอคิวไม่ถูกต้อง" }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;
  // Same gate as the table waitlist: no action here moves money or stock.
  const auth = await authenticateRestaurantMutation(req, body, "pos.sell");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const action = String(body.action ?? "").trim().toLowerCase();
  try {
    if (action === "issue") {
      // Retry path for a sale whose number could not be issued at checkout.
      const orderId = String(body.orderId ?? "").trim();
      if (!orderId) return NextResponse.json({ error: "ไม่ได้ระบุบิล" }, { status: 400 });
      if (!UUID.test(orderId)) return NextResponse.json({ error: "รหัสบิลไม่ถูกต้อง" }, { status: 400 });
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
    if (!UUID.test(entryId)) return NextResponse.json({ error: "รหัสคิวไม่ถูกต้อง" }, { status: 400 });
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
