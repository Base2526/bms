// แพ็กเกจสมาชิกของร้านบอร์ดเกม (`9.92`)
//
// GET  — แคตตาล็อกแพ็กเกจ + สัญญาของสมาชิก (อ่านได้ด้วยสิทธิ์จัดการโต๊ะ เพราะคนหน้าร้าน
//        ต้องรู้ว่าลูกค้าที่นั่งอยู่ถือแพ็กเกจอะไร ก่อนอธิบายยอดให้ฟัง)
// POST — แก้แคตตาล็อก / ขายแพ็กเกจ / ยกเลิก ทั้งสามใช้ `board_game.pass.manage`
//        เพราะทั้งสามเปลี่ยน "สิ่งที่ร้านติดค้างลูกค้าไว้"
import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import {
  cancelBoardGameMemberPass,
  issueBoardGameMemberPass,
  listBoardGameMemberPasses,
  listBoardGamePassPlans,
  upsertBoardGamePassPlan,
} from "@/lib/bms/boardGameCafe";
import { isIdempotencyConflictError } from "@/lib/bms/idempotencyErrors";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("board_game.session.manage");
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  try {
    const url = new URL(req.url);
    const [plans, passes] = await Promise.all([
      listBoardGamePassPlans(auth.tenantId),
      listBoardGameMemberPasses(auth.tenantId, {
        customerId: url.searchParams.get("customerId"),
        activeOnly: url.searchParams.get("activeOnly") === "1",
      }),
    ]);
    return NextResponse.json({ plans, passes });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "โหลดแพ็กเกจไม่สำเร็จ" },
      { status: 400 }
    );
  }
}

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("board_game.pass.manage");
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  try {
    const body = await req.json();
    const action = String(body?.action ?? "");
    if (action === "plan") {
      return NextResponse.json({ plan: await upsertBoardGamePassPlan(auth.tenantId, body, String(auth.adminId)) });
    }
    if (action === "issue") {
      return NextResponse.json({ pass: await issueBoardGameMemberPass(auth.tenantId, body, String(auth.adminId)) });
    }
    if (action === "cancel") {
      const pass = await cancelBoardGameMemberPass(
        auth.tenantId, String(body?.passId ?? ""), body, String(auth.adminId)
      );
      return NextResponse.json({ pass });
    }
    return NextResponse.json({ error: "คำสั่งไม่ถูกต้อง" }, { status: 400 });
  } catch (error) {
    // คีย์เดิมกับข้อมูลคนละชุด = ดึงของจริงมาดู ไม่ใช่ยิงซ้ำ (ตารางรหัสของไคลเอนต์)
    if (isIdempotencyConflictError(error)) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "บันทึกแพ็กเกจไม่สำเร็จ" },
      { status: 400 }
    );
  }
}

export const GET = withRouteErrorLog("GET /api/bms/board-game/passes", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/board-game/passes", handlePOST);
