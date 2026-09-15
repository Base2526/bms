// =============================================================
// POST /api/pos/board-game — โต๊ะ/เวลาเล่นบอร์ดเกมที่เครื่องขาย (เบราว์เซอร์)
// -------------------------------------------------------------
// แอป RN คุยเรื่องเดียวกันผ่าน GraphQL (`bmsPosBoardGame*`) ส่วนจอ `/pos` ไม่มี Apollo
// provider โดยตั้งใจ (layout ของหน้าเครื่องขายเลี่ยง bundle นั้นไว้) จึงต้องมีทาง REST
//
// สองฝั่งเรียก `lib/bms/boardGamePosOperations.ts` ตัวเดียวกัน — ตารางสิทธิ์ ด่านสาขา และ
// การแปลง input อยู่ที่นั่นที่เดียว ที่นี่เหลือแค่ "ยืนยันตัวตนแบบ REST" กับ "แปลง error เป็น HTTP"
//
// อ่านก็ต้องมี PIN เหมือนกัน: ข้อมูลโต๊ะมีชื่อลูกค้า/สมาชิกอยู่ด้วย และ GraphQL ก็บังคับ
// เท่ากัน · ใช้ POST ทั้งหมดเพื่อไม่ให้ PIN ไปโผล่ใน query string ของ access log
// (รูปเดียวกับ `/api/pos/expense` ที่ `action: "list"` ก็เป็น POST)
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  BOARD_GAME_POS_ACTIONS,
  isBoardGamePosAction,
  isBoardGamePosError,
  loadBoardGamePosCheckout,
  loadBoardGamePosSession,
  loadBoardGamePosWorkspace,
  runBoardGamePosMutation,
  type BoardGamePosScope,
} from "@/lib/bms/boardGamePosOperations";
import { isIdempotencyConflictError } from "@/lib/bms/idempotencyErrors";
import {
  authenticatePosDevice,
  cashierHasPermission,
  getOpenPosShift,
  verifyCashierPin,
} from "@/lib/bms/pos";
import { posPermissionDeniedMessage } from "@/lib/bms/posApprovals";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

async function handlePOST(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) return fail("device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว", 401);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action;
  if (!isBoardGamePosAction(action)) return fail("คำสั่งบอร์ดเกมไม่ถูกต้อง", 400);
  const spec = BOARD_GAME_POS_ACTIONS[action];

  const cashierUserId = typeof body.cashierUserId === "string" ? body.cashierUserId.trim() : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!UUID_RE.test(cashierUserId) || !pin || pin.length > 32) {
    return fail("ต้องระบุพนักงานและ PIN", 400);
  }
  const actor = await verifyCashierPin(device.tenantId, cashierUserId, pin);
  if (!actor.ok) {
    return fail(
      actor.reason === "NO_PIN"
        ? "พนักงานคนนี้ยังไม่ได้ตั้ง PIN — ตั้งจากหน้าแอดมินก่อน"
        : actor.reason === "LOCKED"
          ? "ใส่ PIN ผิดหลายครั้ง ถูกล็อกชั่วคราว"
          : "PIN ไม่ถูกต้อง",
      403,
    );
  }

  for (const permission of [spec.permission, ...spec.extraPermissions(body)]) {
    if (!(await cashierHasPermission(device.tenantId, actor.userId, permission))) {
      return fail(await posPermissionDeniedMessage(device.tenantId, permission), 403);
    }
  }

  let shiftId: string | null = null;
  if (spec.requiresOpenShift) {
    const shift = await getOpenPosShift(device.tenantId, device.id);
    if (!shift) return fail("ต้องเปิดกะของเครื่องนี้ก่อน", 409);
    shiftId = shift.id;
  }

  const scope: BoardGamePosScope = {
    tenantId: device.tenantId,
    locationId: device.locationId,
    deviceId: device.id,
    shiftId,
  };

  try {
    if (action === "workspace") {
      return NextResponse.json(await loadBoardGamePosWorkspace(scope));
    }
    if (action === "session") {
      return NextResponse.json({ session: await loadBoardGamePosSession(scope, body.sessionId) });
    }
    if (action === "checkout") {
      return NextResponse.json({ checkout: await loadBoardGamePosCheckout(scope, body.billingGroupId) });
    }
    const result = await runBoardGamePosMutation(scope, actor.userId, action, body);
    return NextResponse.json({ result });
  } catch (error) {
    // การปฏิเสธตามกติกาต้องคืน "เหตุผลจริง" — ถ้าปล่อยให้ตกไปที่ตัวจัดการกลาง มันจะเป็น 500
    // ที่ข้อความถูกลบทิ้งบน production แล้วคนหน้าเครื่องเห็นแค่ "เซิร์ฟเวอร์ผิดพลาด"
    if (isBoardGamePosError(error)) {
      const status = error.reason === "BAD_INPUT" ? 400 : error.reason === "NOT_FOUND" ? 404 : 409;
      return NextResponse.json({ status: error.reason, error: error.message }, { status });
    }
    if (isIdempotencyConflictError(error)) {
      return NextResponse.json(
        { status: "IDEMPOTENCY_CONFLICT", error: error.message },
        { status: 409 },
      );
    }
    throw error;
  }
}

export const POST = withRouteErrorLog("POST /api/pos/board-game", handlePOST);
