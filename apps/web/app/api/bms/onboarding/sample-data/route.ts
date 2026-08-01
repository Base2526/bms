import { NextResponse } from "next/server";
import { verifyAdminSession } from "@/lib/auth/server";
import { query } from "@/lib/db";
import { createOnboardingSampleData, OnboardingSampleDataError } from "@/lib/bms/onboardingSampleData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const admin = verifyAdminSession();
  if (!admin?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userRes = await query<{ tenant_id: string | null; role: string | null }>(
    `SELECT tenant_id, role FROM users WHERE id = $1`,
    [admin.id]
  );
  const user = userRes.rows[0];
  if (!user?.tenant_id) {
    return NextResponse.json({ error: "ไม่พบร้านของผู้ใช้" }, { status: 400 });
  }
  if (!["Administrator", "Manager"].includes(String(user.role || ""))) {
    return NextResponse.json({ error: "เฉพาะ Administrator หรือ Manager" }, { status: 403 });
  }

  try {
    const result = await createOnboardingSampleData(user.tenant_id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    if (error instanceof OnboardingSampleDataError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    console.error("[BMS] onboarding sample data failed:", error);
    return NextResponse.json({ error: "สร้าง sample data ไม่สำเร็จ กรุณาลองอีกครั้งเพื่อทำต่อจากจุดเดิม" }, { status: 500 });
  }
}
