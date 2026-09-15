import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import {
  checkoutBoardGameCopy,
  locationOfBoardGameLoan,
  locationOfBoardGameSession,
  returnBoardGameCopy,
} from "@/lib/bms/boardGameCafe";
import { requirePermission } from "@/lib/bms/permissions";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { canAccessBoardGameLocation } from "../../access";

export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("board_game.session.manage");
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  try {
    const body = await req.json();
    const action = String(body.action ?? "");
    if (action === "checkout") {
      const locationId = await locationOfBoardGameSession(auth.tenantId, body.sessionId);
      if (!(await canAccessBoardGameLocation(auth, locationId))) {
        return NextResponse.json({ error: "ไม่มีสิทธิ์ยืมเกมให้ session นี้" }, { status: 403 });
      }
      const loan = await checkoutBoardGameCopy(auth.tenantId, body, String(auth.adminId));
      return NextResponse.json({ loan });
    }
    if (action === "return") {
      const locationId = await locationOfBoardGameLoan(auth.tenantId, body.loanId);
      if (!(await canAccessBoardGameLocation(auth, locationId))) {
        return NextResponse.json({ error: "ไม่มีสิทธิ์รับคืนเกมรายการนี้" }, { status: 403 });
      }
      if (body.copyStatus && !["AVAILABLE", "NEEDS_CHECK"].includes(body.copyStatus)) {
        try {
          await requirePermission(auth.ctx, "board_game.library.manage");
        } catch {
          return NextResponse.json({ error: "ไม่มีสิทธิ์เปลี่ยนสถานะทรัพย์สินเกม" }, { status: 403 });
        }
      }
      const loan = await returnBoardGameCopy(auth.tenantId, body, String(auth.adminId));
      return NextResponse.json({ loan });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "อัปเดตการยืมเกมไม่สำเร็จ" },
      { status: 400 }
    );
  }
}

export const POST = withRouteErrorLog("POST /api/bms/board-game/library/loans", handlePOST);
