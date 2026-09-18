import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import {
  listBoardGameOffers,
  locationOfBoardGameOffer,
  upsertBoardGameOffer,
} from "@/lib/bms/boardGameOffers";
import { listLocationsForUser } from "@/lib/bms/locations";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { canAccessBoardGameLocation } from "../access";

export const dynamic = "force-dynamic";

async function handleGET() {
  const auth = await authorizeAdminRoute("board_game.session.manage");
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  try {
    const visible = (await listLocationsForUser(auth.tenantId, String(auth.adminId))).map((row) => row.id);
    return NextResponse.json({ offers: await listBoardGameOffers(auth.tenantId, visible) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "โหลดโปรโมชันไม่สำเร็จ" }, { status: 400 });
  }
}

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("board_game.offer.manage");
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  try {
    const body = await req.json();
    const offerId = String(body?.id ?? "").trim();
    if (offerId) {
      const previousLocationId = await locationOfBoardGameOffer(auth.tenantId, offerId);
      if (previousLocationId && !(await canAccessBoardGameLocation(auth, previousLocationId))) {
        return NextResponse.json({ error: "ไม่มีสิทธิ์แก้โปรโมชันของสาขานี้" }, { status: 403 });
      }
    }
    const targetLocationId = String(body?.locationId ?? "").trim() || null;
    if (targetLocationId && !(await canAccessBoardGameLocation(auth, targetLocationId))) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์ผูกโปรโมชันกับสาขานี้" }, { status: 403 });
    }
    return NextResponse.json({
      offer: await upsertBoardGameOffer(auth.tenantId, body, String(auth.adminId)),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "บันทึกโปรโมชันไม่สำเร็จ" }, { status: 400 });
  }
}

export const GET = withRouteErrorLog("GET /api/bms/board-game/offers", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/board-game/offers", handlePOST);

