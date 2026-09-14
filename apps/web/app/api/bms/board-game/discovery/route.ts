import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import {
  getBoardGamePublicLocationProfile,
  upsertBoardGamePublicLocationProfile,
} from "@/lib/bms/boardGameCafe";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { canAccessBoardGameLocation } from "../access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("board_game.floor.manage");
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  const locationId = req.nextUrl.searchParams.get("locationId");
  if (!locationId) return NextResponse.json({ error: "locationId is required" }, { status: 400 });
  if (!(await canAccessBoardGameLocation(auth, locationId))) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์ดูสาขานี้" }, { status: 403 });
  }
  try {
    const profile = await getBoardGamePublicLocationProfile(auth.tenantId, locationId);
    return NextResponse.json({ profile });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "โหลดการตั้งค่าหน้าค้นหาไม่สำเร็จ" },
      { status: 400 }
    );
  }
}

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("board_game.floor.manage");
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  try {
    const body = await req.json();
    if (!(await canAccessBoardGameLocation(auth, body.locationId))) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์จัดการสาขานี้" }, { status: 403 });
    }
    const profile = await upsertBoardGamePublicLocationProfile(
      auth.tenantId,
      body,
      String(auth.adminId)
    );
    return NextResponse.json({ profile });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "บันทึกการตั้งค่าหน้าค้นหาไม่สำเร็จ" },
      { status: 400 }
    );
  }
}

export const GET = withRouteErrorLog("GET /api/bms/board-game/discovery", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/board-game/discovery", handlePOST);
