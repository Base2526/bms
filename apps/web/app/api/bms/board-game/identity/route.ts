// บัตรที่ร้านถือไว้ค้ำกล่องเกม (`9.93`)
//
// GET  — บัตรของโต๊ะหนึ่ง หรือ "ตอนนี้ถือบัตรใครอยู่บ้าง" ของสาขา · ใช้สิทธิ์จัดการโต๊ะ
//        เพราะคนหน้าเคาน์เตอร์ต้องหาบัตรใบที่ถูกในลิ้นชักได้
// POST — take / release ใช้สิทธิ์จัดการโต๊ะ (งานเคาน์เตอร์) · **reveal ใช้สิทธิ์ของตัวเอง**
//        (`board_game.identity.reveal`, seed ให้ Manager) เพราะการอ่านเลขเอกสารกลับออกมา
//        เป็นการกระทำคนละอย่างกับการรับบัตรไว้ และเป็นอย่างเดียวที่ต้องอธิบายได้ว่าทำไมถึงอ่าน
import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { locationOfBoardGameSession } from "@/lib/bms/boardGameCafe";
import {
  listBoardGameIdentityHolds,
  locationOfBoardGameIdentityHold,
  releaseBoardGameIdentityHold,
  revealBoardGameIdentityNumber,
  takeBoardGameIdentityHold,
} from "@/lib/bms/boardGameIdentity";
import { isIdempotencyConflictError } from "@/lib/bms/idempotencyErrors";
import { requirePermission } from "@/lib/bms/permissions";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { canAccessBoardGameLocation } from "../access";

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("board_game.session.manage");
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("sessionId");
    const locationId = url.searchParams.get("locationId");
    // ขอบเขตของคำตอบต้องมาจากสาขาที่คนนี้ดูแลจริง ไม่ใช่จากพารามิเตอร์ที่ส่งมาเฉย ๆ
    const scopeLocationId = sessionId
      ? await locationOfBoardGameSession(auth.tenantId, sessionId)
      : locationId;
    if (!(await canAccessBoardGameLocation(auth, scopeLocationId))) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์ดูบัตรของสาขานี้" }, { status: 403 });
    }
    const holds = await listBoardGameIdentityHolds(auth.tenantId, {
      sessionId,
      locationId: sessionId ? null : scopeLocationId,
      openOnly: url.searchParams.get("openOnly") === "1",
    });
    return NextResponse.json({ holds });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "โหลดรายการบัตรไม่สำเร็จ" },
      { status: 400 }
    );
  }
}

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("board_game.session.manage");
  if (!auth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  try {
    const body = await req.json();
    const action = String(body?.action ?? "");

    if (action === "take") {
      const locationId = await locationOfBoardGameSession(auth.tenantId, String(body?.sessionId ?? ""));
      if (!(await canAccessBoardGameLocation(auth, locationId))) {
        return NextResponse.json({ error: "ไม่มีสิทธิ์รับบัตรของโต๊ะนี้" }, { status: 403 });
      }
      const hold = await takeBoardGameIdentityHold(auth.tenantId, body, String(auth.adminId));
      return NextResponse.json({ hold });
    }

    const holdId = String(body?.holdId ?? "");
    const holdLocationId = await locationOfBoardGameIdentityHold(auth.tenantId, holdId);
    if (!(await canAccessBoardGameLocation(auth, holdLocationId))) {
      return NextResponse.json({ error: "ไม่พบบัตรที่รับไว้ในสาขาที่คุณดูแล" }, { status: 403 });
    }

    if (action === "release") {
      const hold = await releaseBoardGameIdentityHold(auth.tenantId, holdId, body, String(auth.adminId));
      return NextResponse.json({ hold });
    }
    if (action === "reveal") {
      try {
        await requirePermission(auth.ctx, "board_game.identity.reveal");
      } catch {
        return NextResponse.json({ error: "ไม่มีสิทธิ์อ่านเลขเอกสารที่เก็บไว้" }, { status: 403 });
      }
      const revealed = await revealBoardGameIdentityNumber(
        auth.tenantId, holdId, String(auth.adminId), body?.reason
      );
      return NextResponse.json(revealed);
    }
    return NextResponse.json({ error: "คำสั่งไม่ถูกต้อง" }, { status: 400 });
  } catch (error) {
    if (isIdempotencyConflictError(error)) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "บันทึกบัตรไม่สำเร็จ" },
      { status: 400 }
    );
  }
}

export const GET = withRouteErrorLog("GET /api/bms/board-game/identity", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/board-game/identity", handlePOST);
