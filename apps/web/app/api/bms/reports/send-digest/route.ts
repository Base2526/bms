// =============================================================
// POST /api/bms/reports/send-digest — cron ส่งสรุปยอดขายรายวัน/สัปดาห์/เดือน
// -------------------------------------------------------------
//   curl -X POST "http://localhost:3000/api/bms/reports/send-digest" \
//     -H "x-cron-secret: $BMS_CRON_SECRET"
//
// ป้องกันด้วย header x-cron-secret = env BMS_CRON_SECRET (บังคับ — ไม่ตั้ง env = ปฏิเสธทุกคำขอ) — pattern
// เดียวกับ /api/bms/channels/check-health และ /api/bms/ai/check-health
// Docker/GitHub scheduler ยิงทุกชั่วโมง (idempotency มาจาก last_period_key
// ใน bms_report_subscriptions ไม่ใช่ความถี่ cron)
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runScheduledDigests } from "@/lib/bms/reportDigest";
import { recordJobRun } from "@/lib/bms/jobRuns";
import { authorizeCronRequest } from "@/lib/bms/cronRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const cron = authorizeCronRequest(req);
  if (!cron.ok) return cron.response;

  try {
    const result = await recordJobRun("report-digest", "cron", () => runScheduledDigests());
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "send-digest failed" }, { status: 500 });
  }
}

export const POST = withRouteErrorLog("POST /api/bms/reports/send-digest", handlePOST);
