// =============================================================
// POST /api/bms/channels/check-health — cron ตรวจช่องทางที่ไม่มี event เข้านานผิดปกติ
// -------------------------------------------------------------
//   curl -X POST "http://localhost:3000/api/bms/channels/check-health" \
//     -H "x-cron-secret: $BMS_CRON_SECRET"
//
// ป้องกันด้วย header x-cron-secret = env BMS_CRON_SECRET (ถ้าตั้งไว้) — ตาม pattern
// เดียวกับ /api/bms/orders/release-expired
// ตั้ง cron ให้ยิง endpoint นี้วันละครั้งพอ (threshold เป็นวัน ไม่ใช่นาที) เช่น 0 * * * *
// สแกนทุก tenant ในครั้งเดียว (ไม่รับ tenantId) — token_expired/webhook_failed/rate_limited/
// send_failed มาจาก error จริงตอน webhook/send API อยู่แล้ว ไม่ต้องมี cron แยก
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { detectStaleChannels } from "@/lib/bms/channelHealth";
import { recordJobRun } from "@/lib/bms/jobRuns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.BMS_CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const flagged = await recordJobRun("channel-health", "cron", () => detectStaleChannels());
    return NextResponse.json({ ok: true, flagged });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
