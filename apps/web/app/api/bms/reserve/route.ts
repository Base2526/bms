// =============================================================
// POST /api/bms/reserve — กันของไว้ให้ลูกค้าโดยยังไม่ตัดสต็อก
// -------------------------------------------------------------
//   curl -X POST http://localhost:3000/api/bms/reserve \
//     -H "content-type: application/json" \
//     -b "<admin session cookie>" \
//     -d '{"sku":"NIKE-AIR","size":"XL","qty":2}'
//
// เพิ่ม reserved_stock แบบ atomic (กัน oversell) — ไม่ตัด current_stock
// จนกว่าจะจัดส่งจริง ตาม BUSINESS_RULES (Available = Current - Reserved)
//
// **route นี้เคยเปิดโล่งและไม่มี tenant** — middleware กัน `/admin/**` เท่านั้น
// (`/api/**` ผ่านฟรีถ้าไม่ได้ขึ้นต้นด้วย /admin) และ `reserveStock()` เดิมก็ไม่กรอง
// tenant_id เลย ใครก็ยิงเข้ามากันของของทุกร้านที่ขาย SKU นั้นได้พร้อมกันทีเดียว
// ตอนนี้ต้องเป็นแอดมินที่ล็อกอินแล้วและมีสิทธิ์ `stock.adjust` โดย **tenant มาจาก
// session/คุกกี้ drill-down ที่เซ็นไว้เท่านั้น ห้ามรับจาก body** ไม่งั้นก็กลับไปเป็น
// ช่องเดิมที่ระบุร้านปลายทางเองได้
//
// เส้นทางปกติของการจองยังเป็นการสร้างบิล (`createOrder`) ซึ่งจองในทรานแซกชันเดียว
// กับบิล · route นี้มีไว้สำหรับการกันของที่ไม่มีบิล และตอนนี้เขียน movement `RESERVE`
// ทุกครั้ง ของที่ถูกกันไว้จึงตามหาที่มาได้จากประวัติการเคลื่อนไหว
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { reserveStock } from "@/lib/bms/stock";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("stock.adjust");
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "unauthorized" : "forbidden" },
      { status: auth.status }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    sku?: unknown;
    size?: unknown;
    qty?: unknown;
    locationId?: unknown;
    note?: unknown;
  };

  const sku = typeof body.sku === "string" ? body.sku.trim() : "";
  const size = typeof body.size === "string" ? body.size.trim() : "";
  const qty = Number(body.qty);
  // สาขารับจาก body ได้ (แอดมินร้านเดียวกันมีหลายสาขา) แต่ tenant ห้ามรับ —
  // ถ้าสาขาที่ส่งมาไม่ใช่ของร้านนี้ UPDATE จะไม่เจอแถวแล้วได้ NOT_FOUND
  const locationId = typeof body.locationId === "string" && body.locationId.trim()
    ? body.locationId.trim()
    : null;
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;

  if (!sku || !size || !Number.isInteger(qty) || qty <= 0) {
    return NextResponse.json(
      { error: "sku, size, qty (positive integer) are required" },
      { status: 400 }
    );
  }

  const result = await reserveStock({
    tenantId: auth.tenantId,
    sku,
    size,
    qty,
    locationId,
    note,
    actor: String(auth.adminId),
  });

  const httpStatus =
    result.status === "RESERVED"
      ? 200
      : result.status === "NOT_FOUND"
      ? 404
      : 409; // INSUFFICIENT → conflict

  return NextResponse.json(result, { status: httpStatus });
}

export const POST = withRouteErrorLog("POST /api/bms/reserve", handlePOST);
