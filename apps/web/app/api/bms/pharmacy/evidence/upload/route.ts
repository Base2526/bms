// =============================================================
// POST /api/bms/pharmacy/evidence/upload — เภสัชกรแนบรูปใบสั่งยาจากหน้าคิว
// -------------------------------------------------------------
// รูปไม่ผ่าน GraphQL (multipart) จึงต้องมี REST คู่กับ mutation ที่รับข้อความ
// สิทธิ์เดียวกับ mutation: pharmacy.evidence.manage
// tenant มาจาก session/คุกกี้ drill-down เท่านั้น
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { addClinicalEvidence } from "@/lib/bms/pharmacy/clinicalEvidence";
import { persistWebFile } from "@/lib/storage";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("pharmacy.evidence.manage");
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "unauthorized" : "forbidden" },
      { status: auth.status }
    );
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "อ่านฟอร์มไม่สำเร็จ" }, { status: 400 });

  const assessmentId = String(form.get("assessmentId") ?? "").trim();
  if (!assessmentId) return NextResponse.json({ error: "assessmentId จำเป็น" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "ต้องแนบไฟล์" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "ไฟล์ใหญ่เกิน 10MB" }, { status: 413 });
  const mime = (file.type || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json({ error: "รับเฉพาะรูปภาพ (PNG/JPEG/WebP/GIF) หรือ PDF" }, { status: 400 });
  }

  // รูปใบสั่งยาเป็นข้อมูลสุขภาพ — private เสมอ (9.26)
  const row = await persistWebFile(file, undefined, "private", auth.tenantId);
  const result = await addClinicalEvidence({
    tenantId: auth.tenantId,
    assessmentId,
    kind: "PRESCRIPTION_IMAGE",
    file: {
      id: row.id,
      name: row.original_name ?? file.name ?? null,
      mimetype: row.mimetype ?? mime,
      size: row.size == null ? null : Number(row.size),
    },
    actorUserId: auth.adminId == null ? null : String(auth.adminId),
    source: "queue",
  });

  if (result.status === "CASE_NOT_FOUND") {
    return NextResponse.json({ error: "ไม่พบเคสนี้ในร้านนี้" }, { status: 404 });
  }
  if (result.status === "INVALID") {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({ status: "ADDED", evidence: result.evidence });
}

export const POST = withRouteErrorLog("POST /api/bms/pharmacy/evidence/upload", handlePOST);
