import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { createBoardGameCopy, createBoardGameTitle, listBoardGameLibrary } from "@/lib/bms/boardGameCafe";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { canAccessBoardGameLocation } from "../access";

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("board_game.library.view");
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  const locationId = req.nextUrl.searchParams.get("locationId");
  if (!locationId) return NextResponse.json({ error: "locationId is required" }, { status: 400 });
  if (!(await canAccessBoardGameLocation(auth, locationId))) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์ดูคลังเกมของสาขานี้" }, { status: 403 });
  }
  try {
    const titles = await listBoardGameLibrary(auth.tenantId, locationId);
    return NextResponse.json({ titles });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "โหลดคลังเกมไม่สำเร็จ" },
      { status: 400 }
    );
  }
}

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("board_game.library.manage");
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  try {
    const body = await req.json();
    if (body.target !== "title" && body.target !== "copy") {
      return NextResponse.json({ error: "Unknown target" }, { status: 400 });
    }
    const target = body.target;
    if (target === "copy" && !(await canAccessBoardGameLocation(auth, body.locationId))) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เพิ่มเกมในสาขานี้" }, { status: 403 });
    }
    const result = target === "copy"
      ? await createBoardGameCopy(auth.tenantId, body, String(auth.adminId))
      : await createBoardGameTitle(auth.tenantId, body, String(auth.adminId));
    return NextResponse.json({ [target]: result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "บันทึกคลังเกมไม่สำเร็จ" },
      { status: 400 }
    );
  }
}

export const GET = withRouteErrorLog("GET /api/bms/board-game/library", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/board-game/library", handlePOST);
