// apps/web/app/api/dev/fake/bms-customers/route.ts
// สร้าง BMS customers จำนวนมากในคิวรี่เดียว (generate_series)
// mark ด้วย tag 'fake' เพื่อ cleanup ได้
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminOrInternal, fakeSeedDisabled } from "@/lib/dev-guards";
import { query } from "@/lib/db";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (fakeSeedDisabled()) return NextResponse.json({ error: "Disabled in production (set BMS_ALLOW_FAKE_SEED=1 to enable)" }, { status: 403 });

  const guard = requireAdminOrInternal(req);
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const count = Math.min(Math.max(Number(body?.count) || 5, 1), 2000);
  // seed ลงร้านของผู้ล็อกอิน (ร้านค้าเทสได้เอง เห็นใน list ตัวเอง) — fallback: body.tenantId → default
  const tenantId = guard.actor?.tenant_id
    || (typeof body?.tenantId === "string" && body.tenantId.trim() ? body.tenantId.trim() : DEFAULT_TENANT_ID);

  const tags = ["VIP", "ลูกค้าใหม่", "ลูกค้าประจำ"];
  const sql = `
    INSERT INTO bms_customers (tenant_id, name, phone, tags)
    SELECT $1,
           'Fake Customer ' || g,
           '08' || lpad(floor(random() * 100000000)::bigint::text, 8, '0'),
           ARRAY['fake', ($3::text[])[1 + floor(random() * array_length($3::text[], 1))::int]]
      FROM generate_series(1, $2) g
    RETURNING id, name, phone, tags`;

  try {
    const { rows } = await query(sql, [tenantId, count, tags]);
    return NextResponse.json({ ok: true, created: rows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "insert failed" }, { status: 500 });
  }
}
