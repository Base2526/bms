// apps/web/app/api/bms/inbox/upload/route.ts
// อัปโหลดไฟล์แนบสำหรับ Inbox → เก็บลง storage → คืน { url, name, mimeType }
// จากนั้น client เรียก bmsSendMessage(..., attachment) เพื่อส่งจริง (gate inbox.reply ที่ resolver)
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { persistWebFile, buildFileUrlById } from "@/lib/storage";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024; // 10MB

async function handlePOST(req: NextRequest) {
  // เดิม gate ด้วย "ล็อกอินแล้ว" เฉย ๆ ไม่ดูสิทธิ์ — staff ที่ไม่มีสิทธิ์แก้ไฟล์แนบในแชทก็อัปโหลดไฟล์
  // เข้า storage ของระบบได้ · ใช้สิทธิ์เดียวกับขั้นที่เอาไฟล์ไปใช้จริง (resolver ที่บันทึก)
  const auth = await authorizeAdminRoute("inbox.reply");
  if (!auth.ok) return NextResponse.json({ error: auth.status === 401 ? "unauthorized" : "forbidden" }, { status: auth.status });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "ไฟล์ใหญ่เกิน 10MB" }, { status: 413 });

  try {
    const row = await persistWebFile(file);
    return NextResponse.json({
      url: buildFileUrlById(row.id),
      name: row.original_name ?? file.name ?? null,
      mimeType: row.mimetype ?? file.type ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "upload failed" }, { status: 500 });
  }
}

export const POST = withRouteErrorLog("POST /api/bms/inbox/upload", handlePOST);
