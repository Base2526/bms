// =============================================================
// /api/bms/commission — อัตราคอมและรายงานคอมต่อพนักงาน (8.5)
// -------------------------------------------------------------
// GET  ?from=&to=   รายงาน (ต้องมี commission.view)
// GET  ?rules=1     รายการอัตรา
// POST {action:"upsert"|"delete"}  แก้อัตรา (ต้องมี commission.manage)
//
// .view กับ .manage แยกกันเพราะอัตราคอมคือเงินเดือน ไม่ใช่รายงาน — หัวหน้าทีมควร
// ดูยอดของทีมได้โดยไม่มีสิทธิ์ขึ้น/ลดอัตราให้ตัวเอง
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import {
  deleteCommissionRule,
  getCommissionReport,
  listCommissionRules,
  upsertCommissionRule,
  type CommissionScope,
} from "@/lib/bms/commission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCOPES: CommissionScope[] = ["DEFAULT", "PRODUCT", "CATEGORY"];
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function GET(req: NextRequest) {
  const auth = await authorizeAdminRoute("commission.view");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });

  if (req.nextUrl.searchParams.get("rules")) {
    return NextResponse.json({ rules: await listCommissionRules(auth.tenantId) });
  }

  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  if (!isDate(from) || !isDate(to)) {
    return NextResponse.json({ error: "ต้องระบุ from และ to เป็น YYYY-MM-DD" }, { status: 400 });
  }
  if (from > to) return NextResponse.json({ error: "from ต้องไม่เกิน to" }, { status: 400 });

  return NextResponse.json({ report: await getCommissionReport(auth.tenantId, from, to) });
}

export async function POST(req: NextRequest) {
  const auth = await authorizeAdminRoute("commission.manage");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "upsert");

  if (action === "delete") {
    const id = Number(body.id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "id ไม่ถูกต้อง" }, { status: 400 });
    const ok = await deleteCommissionRule(auth.tenantId, id);
    return NextResponse.json({ status: ok ? "DELETED" : "NOT_FOUND" }, { status: ok ? 200 : 404 });
  }

  const scope = String(body.scope ?? "").toUpperCase() as CommissionScope;
  if (!SCOPES.includes(scope)) return NextResponse.json({ error: "scope ไม่ถูกต้อง" }, { status: 400 });

  const result = await upsertCommissionRule({
    tenantId: auth.tenantId,
    scope,
    ref: typeof body.ref === "string" ? body.ref : null,
    percent: Number(body.percent ?? 0),
    effectiveFrom: String(body.effectiveFrom ?? ""),
    note: typeof body.note === "string" ? body.note : null,
    createdBy: String(auth.adminId),
  });
  return NextResponse.json(result, { status: result.status === "SAVED" ? 200 : 400 });
}
