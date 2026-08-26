// =============================================================
// POST /api/bms/followups/run — cron: schedule + process due follow-ups
// -------------------------------------------------------------
//   curl -X POST "http://localhost:3000/api/bms/followups/run" \
//     -H "x-cron-secret: $BMS_CRON_SECRET"
//
// ป้องกันด้วย header x-cron-secret = env BMS_CRON_SECRET (บังคับ — ไม่ตั้ง env = ปฏิเสธทุกคำขอ) — ตาม pattern
// เดียวกับ /api/bms/channels/check-health และ /api/bms/reports/send-digest
// สแกนทุก tenant ในครั้งเดียว (ไม่รับ tenantId) — ยังไม่ได้ตั้ง cron schedule จริง
// (เหมือน 2 endpoint cron เดิม) แนะนำยิงทุก 2-5 นาที
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runDueFollowups } from "@/lib/bms/followups";
import { recordJobRun } from "@/lib/bms/jobRuns";
import { authorizeCronRequest } from "@/lib/bms/cronRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const cron = authorizeCronRequest(req);
  if (!cron.ok) return cron.response;

  try {
    const result = await recordJobRun("followups", "cron", () => runDueFollowups());
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "failed" }, { status: 500 });
  }
}

export const POST = withRouteErrorLog("POST /api/bms/followups/run", handlePOST);
