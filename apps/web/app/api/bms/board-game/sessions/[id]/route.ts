import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import {
  addBoardGameParticipant,
  adjustBoardGameSessionTiming,
  cancelBoardGameSession,
  closeBoardGameBillingGroupForBilling,
  closeBoardGameSessionForBilling,
  getBoardGameSession,
  leaveBoardGameParticipant,
  locationOfBoardGameSession,
  mergeBoardGameSeating,
  moveBoardGameSeating,
} from "@/lib/bms/boardGameCafe";
import { requirePermission } from "@/lib/bms/permissions";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { canAccessBoardGameLocation } from "../../access";

export const dynamic = "force-dynamic";

async function handleGET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdminRoute("board_game.session.manage");
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  try {
    const locationId = await locationOfBoardGameSession(auth.tenantId, params.id);
    if (!(await canAccessBoardGameLocation(auth, locationId))) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์ดู session นี้" }, { status: 403 });
    }
    const session = await getBoardGameSession(auth.tenantId, params.id);
    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "โหลด session ไม่สำเร็จ" },
      { status: 400 }
    );
  }
}

async function handlePOST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdminRoute("board_game.session.manage");
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  try {
    const locationId = await locationOfBoardGameSession(auth.tenantId, params.id);
    if (!(await canAccessBoardGameLocation(auth, locationId))) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์จัดการ session นี้" }, { status: 403 });
    }
    const body = await req.json();
    const action = String(body.action ?? "");
    if (action === "add_participant") {
      if (body.joinedAt != null) {
        try {
          await requirePermission(auth.ctx, "board_game.session.override_time");
        } catch {
          return NextResponse.json({ error: "ไม่มีสิทธิ์กำหนดเวลาเข้าร่วมเอง" }, { status: 403 });
        }
      }
      const participant = await addBoardGameParticipant(
        auth.tenantId,
        { ...body, sessionId: params.id },
        String(auth.adminId)
      );
      return NextResponse.json({ participant });
    }
    if (action === "leave_participant") {
      if (body.leftAt != null) {
        try {
          await requirePermission(auth.ctx, "board_game.session.override_time");
        } catch {
          return NextResponse.json({ error: "ไม่มีสิทธิ์กำหนดเวลาออกเอง" }, { status: 403 });
        }
      }
      const participant = await leaveBoardGameParticipant(
        auth.tenantId,
        { ...body, sessionId: params.id },
        String(auth.adminId)
      );
      return NextResponse.json({ participant });
    }
    if (action === "adjust_timing") {
      try {
        await requirePermission(auth.ctx, "board_game.session.override_time");
      } catch {
        return NextResponse.json({ error: "ไม่มีสิทธิ์แก้ไขเวลา" }, { status: 403 });
      }
      const session = await adjustBoardGameSessionTiming(auth.tenantId, params.id, body, String(auth.adminId));
      return NextResponse.json({ session });
    }
    if (action === "close_for_billing") {
      if (body.endedAt != null) {
        try {
          await requirePermission(auth.ctx, "board_game.session.override_time");
        } catch {
          return NextResponse.json({ error: "ไม่มีสิทธิ์กำหนดเวลาปิดเอง" }, { status: 403 });
        }
      }
      const billing = await closeBoardGameSessionForBilling(auth.tenantId, params.id, body, String(auth.adminId));
      return NextResponse.json({ billing });
    }
    if (action === "close_group_for_billing") {
      if (body.endedAt != null) {
        try {
          await requirePermission(auth.ctx, "board_game.session.override_time");
        } catch {
          return NextResponse.json({ error: "ไม่มีสิทธิ์กำหนดเวลาปิดเอง" }, { status: 403 });
        }
      }
      const billingGroupId = String(body.billingGroupId ?? "");
      const current = await getBoardGameSession(auth.tenantId, params.id);
      if (!current.billingGroups.some((group) => group.id === billingGroupId)) {
        return NextResponse.json({ error: "ไม่พบกลุ่มบิลใน session นี้" }, { status: 404 });
      }
      const billing = await closeBoardGameBillingGroupForBilling(
        auth.tenantId,
        billingGroupId,
        body,
        String(auth.adminId),
      );
      return NextResponse.json({ billing });
    }
    if (action === "move_seating" || action === "merge_seating") {
      const relocate = action === "move_seating" ? moveBoardGameSeating : mergeBoardGameSeating;
      const seating = await relocate(
        auth.tenantId,
        params.id,
        String(body.targetTableId ?? ""),
        body,
        String(auth.adminId),
      );
      return NextResponse.json({ seating });
    }
    if (action === "cancel") {
      try {
        await requirePermission(auth.ctx, "board_game.session.cancel");
      } catch {
        return NextResponse.json({ error: "ไม่มีสิทธิ์ยกเลิก session" }, { status: 403 });
      }
      const session = await cancelBoardGameSession(auth.tenantId, params.id, body, String(auth.adminId));
      return NextResponse.json({ session });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "อัปเดต session ไม่สำเร็จ" },
      { status: 400 }
    );
  }
}

export const GET = withRouteErrorLog("GET /api/bms/board-game/sessions/[id]", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/board-game/sessions/[id]", handlePOST);
