// =============================================================
// POST /api/bms/payment/:id/verify — ตรวจสลิปด้วย OCR/AI (แนะนำเท่านั้น)
// -------------------------------------------------------------
// ไม่เปลี่ยนสถานะ payment — คืนผลตรวจ (ต้องให้คนกดยืนยันเองอยู่ดี)
// =============================================================
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyPaymentSlip } from "@/lib/bms/payments";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdminRoute("payment.confirm");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });
  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "payment id required" }, { status: 400 });
  const result = await verifyPaymentSlip(auth.tenantId, id);
  if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(result);
}

export const POST = withRouteErrorLog("POST /api/bms/payment/[id]/verify", handlePOST);
