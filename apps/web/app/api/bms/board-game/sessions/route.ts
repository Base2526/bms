import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { openBoardGameSession } from "@/lib/bms/boardGameCafe";
import { requirePermission } from "@/lib/bms/permissions";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { canAccessBoardGameLocation } from "../access";

export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("board_game.session.manage");
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  try {
    const body = await req.json();
    if (!(await canAccessBoardGameLocation(auth, body.locationId))) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เปิดโต๊ะในสาขานี้" }, { status: 403 });
    }
    if (body.startedAt != null || body.participants?.some?.((row: any) => row?.joinedAt != null)) {
      try {
        await requirePermission(auth.ctx, "board_game.session.override_time");
      } catch {
        return NextResponse.json({ error: "ไม่มีสิทธิ์กำหนดเวลาเริ่มเอง" }, { status: 403 });
      }
    }
    const session = await openBoardGameSession(auth.tenantId, body, String(auth.adminId));
    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "เปิดโต๊ะบอร์ดเกมไม่สำเร็จ" },
      { status: 400 }
    );
  }
}

export const POST = withRouteErrorLog("POST /api/bms/board-game/sessions", handlePOST);
