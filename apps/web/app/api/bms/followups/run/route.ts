// =============================================================
// POST /api/bms/followups/run — cron: schedule + process due follow-ups
// -------------------------------------------------------------
//   curl -X POST "http://localhost:3000/api/bms/followups/run" \
//     -H "x-cron-secret: $BMS_CRON_SECRET"
//
// ป้องกันด้วย header x-cron-secret = env BMS_CRON_SECRET (ถ้าตั้งไว้) — ตาม pattern
// เดียวกับ /api/bms/channels/check-health และ /api/bms/reports/send-digest
// สแกนทุก tenant ในครั้งเดียว (ไม่รับ tenantId) — ยังไม่ได้ตั้ง cron schedule จริง
// (เหมือน 2 endpoint cron เดิม) แนะนำยิงทุก 2-5 นาที
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runDueFollowups } from "@/lib/bms/followups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.BMS_CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDueFollowups();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "failed" }, { status: 500 });
  }
}
