// แพ็กเกจสมาชิกของร้านบอร์ดเกม (`9.92`)
//
// GET  — แคตตาล็อกแพ็กเกจ + สัญญาของสมาชิก (อ่านได้ด้วยสิทธิ์จัดการโต๊ะ เพราะคนหน้าร้าน
//        ต้องรู้ว่าลูกค้าที่นั่งอยู่ถือแพ็กเกจอะไร ก่อนอธิบายยอดให้ฟัง)
// POST — แก้แคตตาล็อก / ขายแพ็กเกจ / ยกเลิก ทั้งสามใช้ `board_game.pass.manage`
//        เพราะทั้งสามเปลี่ยน "สิ่งที่ร้านติดค้างลูกค้าไว้"
import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import {
  boardGamePassOutstanding,
  boardGamePlanExists,
  cancelBoardGameMemberPass,
  issueBoardGameMemberPass,
  listBoardGameMemberPasses,
  listBoardGamePassPlans,
  locationOfBoardGameMemberPass,
  locationOfBoardGamePassPlan,
  upsertBoardGamePassPlan,
} from "@/lib/bms/boardGameCafe";
import { listLocationsForUser } from "@/lib/bms/locations";
import { canAccessBoardGameLocation } from "../access";
import { isIdempotencyConflictError } from "@/lib/bms/idempotencyErrors";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("board_game.session.manage");
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  try {
    const url = new URL(req.url);
    // แพ็กเกจที่ผูกสาขาต้องไม่โผล่ให้คนที่ไม่ได้ดูแลสาขานั้นเห็น — ไม่งั้นเขาเลือกมันไปขายได้
    // แล้วไปตกด่านตอน issue ซึ่งเป็นการบอกทีหลังว่า "เลือกผิด" ทั้งที่จอเป็นคนยื่นให้เอง
    const visible = (await listLocationsForUser(auth.tenantId, String(auth.adminId)))
      .map((location) => location.id);
    const [plans, passes, outstanding] = await Promise.all([
      listBoardGamePassPlans(auth.tenantId, visible),
      listBoardGameMemberPasses(auth.tenantId, {
        customerId: url.searchParams.get("customerId"),
        activeOnly: url.searchParams.get("activeOnly") === "1",
      }),
      boardGamePassOutstanding(auth.tenantId),
    ]);
    return NextResponse.json({ plans, passes, outstanding });
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
    /**
     * แพ็กเกจที่ผูกสาขาเป็นของสาขานั้น — คนที่ไม่ได้ดูแลสาขานั้นแตะไม่ได้
     *
     * `null` = แพ็กเกจระดับร้าน ซึ่งทุกคนที่ถือสิทธิ์แตะได้ตามนิยามของมันเอง · ต่างจาก
     * "ไม่พบแพ็กเกจ" ที่ต้องเป็น 404 ไม่ใช่ปล่อยผ่านเพราะสาขาเป็น null
     */
    const allowedOnPlan = async (locationId: string | null) =>
      locationId == null || await canAccessBoardGameLocation(auth, locationId);

    if (action === "plan") {
      // แก้แพ็กเกจเดิม: ต้องแตะสาขา **เดิม** ได้ ไม่ใช่เฉพาะสาขาใหม่ที่ส่งมา — ไม่งั้นย้าย
      // แพ็กเกจของสาขาอื่นมาเป็นของตัวเองได้ด้วยคำขอเดียว
      const planId = String(body?.id ?? "").trim();
      if (planId) {
        if (!(await boardGamePlanExists(auth.tenantId, planId))) {
          return NextResponse.json({ error: "ไม่พบแพ็กเกจนี้" }, { status: 404 });
        }
        if (!(await allowedOnPlan(await locationOfBoardGamePassPlan(auth.tenantId, planId)))) {
          return NextResponse.json({ error: "ไม่มีสิทธิ์แก้แพ็กเกจของสาขานี้" }, { status: 403 });
        }
      }
      const target = String(body?.locationId ?? "").trim() || null;
      if (target && !(await canAccessBoardGameLocation(auth, target))) {
        return NextResponse.json({ error: "ไม่มีสิทธิ์ผูกแพ็กเกจกับสาขานี้" }, { status: 403 });
      }
      return NextResponse.json({ plan: await upsertBoardGamePassPlan(auth.tenantId, body, String(auth.adminId)) });
    }
    if (action === "issue") {
      const planId = String(body?.planId ?? "").trim();
      if (!planId || !(await boardGamePlanExists(auth.tenantId, planId))) {
        return NextResponse.json({ error: "ไม่พบแพ็กเกจนี้" }, { status: 404 });
      }
      const planLocationId = await locationOfBoardGamePassPlan(auth.tenantId, planId);
      if (!(await allowedOnPlan(planLocationId))) {
        return NextResponse.json({ error: "ไม่มีสิทธิ์ขายแพ็กเกจของสาขานี้" }, { status: 403 });
      }
      const pass = await issueBoardGameMemberPass(
        // สาขามาจากตัวแพ็กเกจ ไม่ใช่จาก body — ผู้เรียกเลือกสาขาเองไม่ได้
        auth.tenantId, { ...body, locationId: planLocationId }, String(auth.adminId)
      );
      return NextResponse.json({ pass });
    }
    if (action === "cancel") {
      const passId = String(body?.passId ?? "");
      if (!(await allowedOnPlan(await locationOfBoardGameMemberPass(auth.tenantId, passId)))) {
        return NextResponse.json({ error: "ไม่มีสิทธิ์ยกเลิกแพ็กเกจของสาขานี้" }, { status: 403 });
      }
      const pass = await cancelBoardGameMemberPass(
        auth.tenantId, passId, body, String(auth.adminId)
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
