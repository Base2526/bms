// =============================================================
// POST /api/bms/jobs/etax — เดินคิวนำส่ง e-Tax หนึ่งรอบ
// -------------------------------------------------------------
// ตั้งใจให้ cron เรียก ไม่ใช่ให้หน้าเว็บเรียก — การนำส่งเป็นงานเบื้องหลัง
// ที่ยอมช้าได้แต่ยอมหายไม่ได้ · เครื่องขายต้องขายต่อได้แม้ปลายทางล่ม
//
// auth: x-cron-secret / BMS_CRON_SECRET ผ่านการ์ด cron กลาง
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { processEtaxQueue } from "@/lib/bms/etax/queue";
import { etaxEnabledGlobally } from "@/lib/bms/etax/providers";
import { authorizeCronRequest } from "@/lib/bms/cronRouteAuth";
import { recordJobRun } from "@/lib/bms/jobRuns";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const cron = authorizeCronRequest(req);
  if (!cron.ok) return cron.response;
  if (!etaxEnabledGlobally()) {
    return NextResponse.json({ skipped: "ETAX_ENABLED ปิดอยู่" }, { status: 200 });
  }

  const result = await recordJobRun("etax", "cron", async () => {
    // เดินทีละร้านที่เปิด e-Tax ไว้ — ร้านหนึ่งล่มต้องไม่ทำให้ร้านอื่นไม่ได้ส่ง
    const tenants = await query<{ tenant_id: string }>(
      `SELECT tenant_id FROM bms_store_profile WHERE etax_enabled`
    );
    const results: Record<string, unknown> = {};
    let failedTenants = 0;
    for (const t of tenants.rows) {
      try {
        results[t.tenant_id] = await processEtaxQueue(t.tenant_id, 50);
      } catch {
        // Continue other tenants, but do not report this invocation as successful.
        // The queue retains the document-level failure detail for staff review.
        failedTenants++;
      }
    }
    if (failedTenants) throw new Error(`ETAX_TENANT_FAILURE:${failedTenants}`);
    return { tenants: tenants.rowCount, results };
  });
  return NextResponse.json(result);
}

export const POST = withRouteErrorLog("POST /api/bms/jobs/etax", handlePOST);
