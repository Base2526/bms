import { NextResponse, type NextRequest } from "next/server";
import {
  addRestaurantWaitlistEntry,
  callRestaurantWaitlistEntry,
  closeRestaurantWaitlistEntry,
  listRestaurantWaitlist,
  seatRestaurantWaitlistEntry,
} from "@/lib/bms/restaurantWaitlist";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { authenticateRestaurantMutation, authenticateRestaurantRead } from "../routeAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authenticateRestaurantRead(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json(await listRestaurantWaitlist(auth.device.tenantId, auth.device.locationId));
}

async function handlePOST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // คิว/จองใช้ `pos.sell` เหมือนการเปิดโต๊ะ — ไม่มี action ไหนขยับเงินหรือสต็อก และจังหวะ
  // ที่ขยับจริง (เปิดบิลตอนพาไปนั่ง) เดินผ่านด่านเดียวกับหน้าผังโต๊ะอยู่แล้ว
  const auth = await authenticateRestaurantMutation(req, body, "pos.sell");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const action = String(body.action ?? "").trim().toLowerCase();
  const common = {
    tenantId: auth.device.tenantId,
    locationId: auth.device.locationId,
    actorUserId: auth.actor.userId,
  };

  if (action === "add") {
    const entry = await addRestaurantWaitlistEntry({
      ...common,
      kind: body.kind === "RESERVATION" ? "RESERVATION" : "WALK_IN",
      partySize: Number(body.partySize ?? 0),
      guestName: typeof body.guestName === "string" ? body.guestName : null,
      guestPhone: typeof body.guestPhone === "string" ? body.guestPhone : null,
      note: typeof body.note === "string" ? body.note : null,
      preferredTableId: typeof body.preferredTableId === "string" && body.preferredTableId.trim()
        ? body.preferredTableId.trim()
        : null,
      reservedFor: typeof body.reservedFor === "string" ? body.reservedFor : null,
    });
    return NextResponse.json({ entry });
  }

  const entryId = String(body.entryId ?? "").trim();
  if (!entryId) return NextResponse.json({ error: "ไม่ได้ระบุคิว" }, { status: 400 });

  if (action === "call") {
    return NextResponse.json({ entry: await callRestaurantWaitlistEntry({ ...common, entryId }) });
  }
  if (action === "cancel" || action === "no_show") {
    return NextResponse.json({
      entry: await closeRestaurantWaitlistEntry({
        ...common,
        entryId,
        status: action === "cancel" ? "CANCELLED" : "NO_SHOW",
        reason: typeof body.reason === "string" ? body.reason : null,
      }),
    });
  }
  if (action === "seat") {
    const tableId = String(body.tableId ?? "").trim();
    if (!tableId) return NextResponse.json({ error: "เลือกโต๊ะที่จะพาไปนั่งก่อน" }, { status: 400 });
    return NextResponse.json(await seatRestaurantWaitlistEntry({
      ...common,
      deviceId: auth.device.id,
      shiftId: auth.shift.id,
      entryId,
      tableId,
    }));
  }
  return NextResponse.json({ error: "action ไม่ถูกต้อง" }, { status: 400 });
}

export const GET = withRouteErrorLog("GET /api/pos/restaurant/waitlist", handleGET);
export const POST = withRouteErrorLog("POST /api/pos/restaurant/waitlist", handlePOST);
