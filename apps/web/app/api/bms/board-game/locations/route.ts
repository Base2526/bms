import { NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { listBoardGameLocations } from "@/lib/bms/boardGameCafe";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

async function handleGET() {
  const auth = await authorizeAdminRoute("board_game.session.manage");
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  try {
    const locations = await listBoardGameLocations(auth.tenantId, String(auth.adminId));
    return NextResponse.json({ locations });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "โหลดสาขาไม่สำเร็จ" },
      { status: 400 }
    );
  }
}

export const GET = withRouteErrorLog("GET /api/bms/board-game/locations", handleGET);
