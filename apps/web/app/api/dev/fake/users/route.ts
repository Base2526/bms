// apps/web/app/api/dev/fake/users/route.ts
// สร้าง BMS staff ปลอม (role Sales/Warehouse สุ่ม) ให้ร้านของผู้ล็อกอิน — สำหรับเทสหน้า Users/สิทธิ์
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requirePlatformAdminSeeder, fakeSeedDisabled } from "@/lib/dev-guards";
import { query } from "@/lib/db";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";
import { nanoid } from "nanoid";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// role ปฏิบัติการเท่านั้น — ไม่สุ่ม Administrator/Manager กันกระทบสิทธิ์จัดการร้านจริง
const FAKE_STAFF_ROLES = ["Sales", "Warehouse"];

export async function POST(req: NextRequest) {
  if (fakeSeedDisabled()) return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });

  const guard = await requirePlatformAdminSeeder();
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const count = Math.min(Math.max(Number(body?.count) || 3, 1), 200);
  // seed ลงร้านของผู้ล็อกอิน (เห็นใน /admin/users ของร้านตัวเองทันที) — fallback: default tenant
  const tenantId = guard.actor?.tenant_id || DEFAULT_TENANT_ID;

  const password_hash = await bcrypt.hash("password123", 10);
  const created: any[] = [];
  for (let i = 0; i < count; i++) {
    const suffix = nanoid(5);
    const name = `Fake Staff ${suffix}`;
    const email = `fake-staff+${suffix}@example.test`;
    const phone = `08${Math.floor(10000000 + Math.random() * 90000000)}`;
    const role = FAKE_STAFF_ROLES[Math.floor(Math.random() * FAKE_STAFF_ROLES.length)];
    const meta = JSON.stringify({ generated_by: guard.actor?.id ?? "internal", env: process.env.NODE_ENV });

    const { rows } = await query(
      `INSERT INTO users (name, email, phone, role, password_hash, meta, fake_test, tenant_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6, true, $7, NOW()) RETURNING id, name, email, phone, role, created_at`,
      [name, email, phone, role, password_hash, meta, tenantId]
    );
    created.push(rows[0]);
  }

  return NextResponse.json({ ok: true, created });
}
