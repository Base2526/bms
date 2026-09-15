import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { searchMembers } from "@/lib/bms/membership";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("board_game.session.manage");
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  const search = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (search.length < 2 || search.length > 80) {
    return NextResponse.json({ error: "กรุณาค้นสมาชิกอย่างน้อย 2 ตัวอักษร" }, { status: 400 });
  }
  try {
    const members = (await searchMembers(auth.tenantId, search, 10)).map((member) => ({
      customerId: member.customerId,
      name: member.name,
      memberNo: member.memberNo,
    }));
    return NextResponse.json({ members });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "ค้นหาสมาชิกไม่สำเร็จ" },
      { status: 400 }
    );
  }
}

export const GET = withRouteErrorLog("GET /api/bms/board-game/members", handleGET);
