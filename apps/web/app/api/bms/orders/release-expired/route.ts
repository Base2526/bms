// =============================================================
// POST /api/bms/orders/release-expired — cron ยกเลิก order RESERVED ค้าง
// -------------------------------------------------------------
//   curl -X POST "http://localhost:3000/api/bms/orders/release-expired?minutes=30" \
//     -H "x-cron-secret: $BMS_CRON_SECRET"
//
// ป้องกันด้วย header x-cron-secret = env BMS_CRON_SECRET (ถ้าตั้งไว้)
// ตั้ง cron ให้ยิง endpoint นี้ทุก N นาที เช่น */5 * * * *
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { releaseExpiredOrders } from "@/lib/bms/orders";
import { recordJobRun } from "@/lib/bms/jobRuns";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const secret = process.env.BMS_CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const minutes = Number(new URL(req.url).searchParams.get("minutes") ?? 30);
  try {
    const result = await recordJobRun("release-expired", "cron", () => releaseExpiredOrders(minutes));
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}

export const POST = withRouteErrorLog("POST /api/bms/orders/release-expired", handlePOST);
