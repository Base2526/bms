import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { locationOfBoardGameMemberPass } from "@/lib/bms/boardGameCafe";
import {
  createBoardGamePassRenewal,
  listBoardGamePassRenewals,
  locationOfBoardGamePassRenewal,
  runDueBoardGamePassRenewals,
  updateBoardGamePassRenewal,
} from "@/lib/bms/boardGamePassRenewals";
import { listLocationsForUser } from "@/lib/bms/locations";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { canAccessBoardGameLocation } from "../access";

export const dynamic = "force-dynamic";

async function handleGET() {
  const auth = await authorizeAdminRoute("board_game.session.manage");
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  try {
    const visible = (await listLocationsForUser(auth.tenantId, String(auth.adminId))).map((row) => row.id);
    return NextResponse.json({ renewals: await listBoardGamePassRenewals(auth.tenantId, visible) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "โหลดการต่ออายุไม่สำเร็จ" }, { status: 400 });
  }
}

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("board_game.pass.manage");
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  try {
    const body = await req.json();
    const action = String(body?.action ?? "");
    if (action === "create") {
      const memberPassId = String(body?.memberPassId ?? "");
      const locationId = await locationOfBoardGameMemberPass(auth.tenantId, memberPassId);
      if (locationId && !(await canAccessBoardGameLocation(auth, locationId))) {
        return NextResponse.json({ error: "ไม่มีสิทธิ์ตั้งต่ออายุให้แพ็กเกจของสาขานี้" }, { status: 403 });
      }
      return NextResponse.json({ renewal: await createBoardGamePassRenewal(
        auth.tenantId, { memberPassId, storeCreditCode: String(body?.storeCreditCode ?? "") },
        String(auth.adminId),
      ) });
    }
    const renewalId = String(body?.renewalId ?? "");
    const locationId = await locationOfBoardGamePassRenewal(auth.tenantId, renewalId);
    if (locationId && !(await canAccessBoardGameLocation(auth, locationId))) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์จัดการการต่ออายุของสาขานี้" }, { status: 403 });
    }
    if (["pause", "resume", "cancel"].includes(action)) {
      await updateBoardGamePassRenewal(auth.tenantId, renewalId, {
        action: action as "pause" | "resume" | "cancel",
        reason: body?.reason == null ? null : String(body.reason),
      }, String(auth.adminId));
      return NextResponse.json({ ok: true });
    }
    if (action === "retry") {
      await updateBoardGamePassRenewal(auth.tenantId, renewalId, { action: "resume" }, String(auth.adminId));
      return NextResponse.json({ result: await runDueBoardGamePassRenewals({
        tenantId: auth.tenantId, renewalId, limit: 1,
      }) });
    }
    return NextResponse.json({ error: "คำสั่งไม่ถูกต้อง" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "จัดการการต่ออายุไม่สำเร็จ" }, { status: 400 });
  }
}

export const GET = withRouteErrorLog("GET /api/bms/board-game/pass-renewals", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/board-game/pass-renewals", handlePOST);

