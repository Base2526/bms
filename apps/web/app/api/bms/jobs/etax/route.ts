// =============================================================
// POST /api/bms/jobs/etax — เดินคิวนำส่ง e-Tax หนึ่งรอบ
// -------------------------------------------------------------
// ตั้งใจให้ cron เรียก ไม่ใช่ให้หน้าเว็บเรียก — การนำส่งเป็นงานเบื้องหลัง
// ที่ยอมช้าได้แต่ยอมหายไม่ได้ · เครื่องขายต้องขายต่อได้แม้ปลายทางล่ม
//
// auth: header x-job-token เทียบกับ BMS_JOB_TOKEN (เหมือน job อื่นในระบบ)
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { processEtaxQueue } from "@/lib/bms/etax/queue";
import { etaxEnabledGlobally } from "@/lib/bms/etax/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const expected = process.env.BMS_JOB_TOKEN;
  if (!expected || req.headers.get("x-job-token") !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!etaxEnabledGlobally()) {
    return NextResponse.json({ skipped: "ETAX_ENABLED ปิดอยู่" }, { status: 200 });
  }

  // เดินทีละร้านที่เปิด e-Tax ไว้ — ร้านหนึ่งล่มต้องไม่ทำให้ร้านอื่นไม่ได้ส่ง
  const tenants = await query<{ tenant_id: string }>(
    `SELECT tenant_id FROM bms_store_profile WHERE etax_enabled`
  );

  const results: Record<string, unknown> = {};
  for (const t of tenants.rows) {
    try {
      results[t.tenant_id] = await processEtaxQueue(t.tenant_id, 50);
    } catch (e: any) {
      results[t.tenant_id] = { error: String(e?.message ?? e) };
    }
  }
  return NextResponse.json({ tenants: tenants.rowCount, results });
}
