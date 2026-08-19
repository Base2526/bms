// =============================================================
// POST /api/bms/reports/send-digest — cron ส่งสรุปยอดขายรายวัน/สัปดาห์/เดือน
// -------------------------------------------------------------
//   curl -X POST "http://localhost:3000/api/bms/reports/send-digest" \
//     -H "x-cron-secret: $BMS_CRON_SECRET"
//
// ป้องกันด้วย header x-cron-secret = env BMS_CRON_SECRET (ถ้าตั้งไว้) — pattern
// เดียวกับ /api/bms/channels/check-health และ /api/bms/ai/check-health
// ตั้ง cron ให้ยิง endpoint นี้ทุกชั่วโมงพอ (idempotency มาจาก last_period_key
// ใน bms_report_subscriptions ไม่ใช่ความถี่ cron — ยิงถี่กว่านี้ก็ไม่ส่งซ้ำ)
// ยังไม่ได้ตั้ง cron schedule จริง (เหมือน channels/ai check-health เดิม) —
// endpoint พร้อมแล้วแค่ยังไม่มีตัวยิงอัตโนมัติ
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runScheduledDigests } from "@/lib/bms/reportDigest";
import { recordJobRun } from "@/lib/bms/jobRuns";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const secret = process.env.BMS_CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await recordJobRun("report-digest", "cron", () => runScheduledDigests());
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "send-digest failed" }, { status: 500 });
  }
}

export const POST = withRouteErrorLog("POST /api/bms/reports/send-digest", handlePOST);
