import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import {
  listBoardGameFloor,
  locationOfBoardGameArea,
  locationOfBoardGameTable,
  upsertBoardGameArea,
  upsertBoardGameTable,
} from "@/lib/bms/boardGameCafe";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { canAccessBoardGameLocation } from "../access";

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("board_game.session.manage");
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  const locationId = req.nextUrl.searchParams.get("locationId");
  if (!locationId) return NextResponse.json({ error: "locationId is required" }, { status: 400 });
  if (!(await canAccessBoardGameLocation(auth, locationId))) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์ดูสาขานี้" }, { status: 403 });
  }
  try {
    const floor = await listBoardGameFloor(auth.tenantId, locationId);
    return NextResponse.json({ floor });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "โหลดผังโต๊ะไม่สำเร็จ" },
      { status: 400 }
    );
  }
}

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("board_game.floor.manage");
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  try {
    const body = await req.json();
    if (body.target !== "area" && body.target !== "table") {
      return NextResponse.json({ error: "Unknown target" }, { status: 400 });
    }
    const target = body.target;
    if (!(await canAccessBoardGameLocation(auth, body.locationId))) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์จัดการสาขานี้" }, { status: 403 });
    }
    const previousLocationId = body.id
      ? await (target === "table" ? locationOfBoardGameTable : locationOfBoardGameArea)(auth.tenantId, body.id)
      : null;
    if (body.id && !(await canAccessBoardGameLocation(auth, previousLocationId))) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์แก้ไขรายการจากสาขาเดิม" }, { status: 403 });
    }
    const result = target === "table"
      ? await upsertBoardGameTable(auth.tenantId, body, String(auth.adminId))
      : await upsertBoardGameArea(auth.tenantId, body, String(auth.adminId));
    return NextResponse.json({ [target]: result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "บันทึกผังโต๊ะไม่สำเร็จ" },
      { status: 400 }
    );
  }
}

export const GET = withRouteErrorLog("GET /api/bms/board-game/floor", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/board-game/floor", handlePOST);
