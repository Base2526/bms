// =============================================================
// POST /api/bms/loyalty/maintenance — cron ตัดแต้มหมดอายุ + ทบทวนชั้นสมาชิก
// -------------------------------------------------------------
//   curl -X POST "http://localhost:3000/api/bms/loyalty/maintenance" \
//     -H "x-cron-secret: $BMS_CRON_SECRET"
//
// แนะนำวันละครั้ง (เช่น 0 3 * * *) — ทั้งสองงาน idempotent รันซ้ำได้ปลอดภัย
// ตัดแต้มใช้ consumed_points เป็นตัวกัน และทบทวนชั้นเป็นการคำนวณใหม่ทั้งก้อน
//
// ?task=expire | tiers  → รันแค่งานนั้น (default = ทั้งคู่)
//
// ⚠️ repo นี้ยังไม่มีตัวยิง cron จริง — ต้องผูก scheduler ภายนอกหรือกดจากหน้า
//    /admin/loyalty เอง มิฉะนั้นแต้มจะไม่หมดอายุและชั้นสมาชิกจะไม่ถูกทบทวน
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { recordJobRun } from "@/lib/bms/jobRuns";
import { expireLoyaltyPointsAllTenants, reviewMemberTiersAllTenants } from "@/lib/bms/membership";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const secret = process.env.BMS_CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const task = new URL(req.url).searchParams.get("task");
  try {
    const result = await recordJobRun("loyalty-maintenance", "cron", async () => ({
      expired: task === "tiers" ? null : await expireLoyaltyPointsAllTenants(),
      tiers: task === "expire" ? null : await reviewMemberTiersAllTenants(),
    }));
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}

export const POST = withRouteErrorLog("POST /api/bms/loyalty/maintenance", handlePOST);
