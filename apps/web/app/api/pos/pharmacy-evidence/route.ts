// =============================================================
// POST /api/pos/pharmacy-evidence — แนบหลักฐานทางคลินิกจากหน้าเคาน์เตอร์
// -------------------------------------------------------------
// auth เหมือนขายหน้าร้าน: เครื่องยืนยัน tenant, PIN ยืนยันคน, สิทธิ์ pos.sell
//
// ตั้งใจให้ "เขียนได้ อ่านไม่ได้" ที่เคาน์เตอร์ — แคชเชียร์ถ่ายใบสั่งยาที่ลูกค้า
// ยื่นให้เข้าระบบได้ แต่การเปิดดูย้อนหลังต้องมี pharmacy.evidence.read
// (เภสัชกร/แอดมิน) ไม่ใช่ใครก็เปิดดูใบสั่งยาของคนอื่นจากเครื่องขายได้
//
// รับได้ทั้ง multipart (รูป) และ JSON (เลขอ้างอิง/บันทึกคำแนะนำ)
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  authenticatePosDevice,
  cashierHasPermission,
  verifyCashierPin,
} from "@/lib/bms/pos";
import {
  PHARMACY_EVIDENCE_KINDS,
  addClinicalEvidence,
  type PharmacyEvidenceKind,
} from "@/lib/bms/pharmacy/clinicalEvidence";
import { persistWebFile } from "@/lib/storage";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
// ใบสั่งยาเป็นรูปถ่ายหรือ PDF เท่านั้น — ไม่รับ svg/html ที่รันสคริปต์ได้
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

async function handlePOST(req: NextRequest) {
  const device = await authenticatePosDevice(req.headers.get("x-pos-device-token") ?? "");
  if (!device) return bad("device token ไม่ถูกต้องหรือถูกยกเลิกแล้ว", 401);

  const contentType = req.headers.get("content-type") ?? "";
  let fields: Record<string, string> = {};
  let file: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) return bad("อ่านฟอร์มไม่สำเร็จ");
    // ไม่ใช้ form.entries() — TS lib ของโปรเจกต์นี้ไม่มี iterator ให้ FormData
    for (const key of ["cashierUserId", "pin", "assessmentId", "kind", "textValue"]) {
      const value = form.get(key);
      if (typeof value === "string") fields[key] = value;
    }
    const maybeFile = form.get("file");
    if (maybeFile instanceof File) file = maybeFile;
  } else {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    fields = Object.fromEntries(
      Object.entries(body).map(([k, v]) => [k, v == null ? "" : String(v)])
    );
  }

  const cashierUserId = (fields.cashierUserId ?? "").trim();
  const assessmentId = (fields.assessmentId ?? "").trim();
  const kind = (fields.kind ?? "").trim() as PharmacyEvidenceKind;
  if (!cashierUserId || !assessmentId) return bad("cashierUserId และ assessmentId จำเป็น");
  if (!PHARMACY_EVIDENCE_KINDS.includes(kind)) return bad("kind ไม่ถูกต้อง");

  const auth = await verifyCashierPin(device.tenantId, cashierUserId, fields.pin ?? "");
  if (!auth.ok) {
    const message =
      auth.reason === "NO_PIN" ? "พนักงานคนนี้ยังไม่ได้ตั้ง PIN — ตั้งจากหน้าแอดมินก่อน"
      : auth.reason === "LOCKED" ? "ใส่ PIN ผิดหลายครั้ง ถูกล็อกชั่วคราว"
      : "PIN ไม่ถูกต้อง";
    return NextResponse.json({ error: message, reason: auth.reason, lockedUntil: auth.lockedUntil }, { status: 403 });
  }
  if (!(await cashierHasPermission(device.tenantId, auth.userId, "pos.sell"))) {
    return bad("พนักงานคนนี้ไม่มีสิทธิ์ขายหน้าร้าน", 403);
  }

  let stored: { id: number; name: string | null; mimetype: string | null; size: number | null } | null = null;
  if (kind === "PRESCRIPTION_IMAGE") {
    if (!file) return bad("ต้องแนบไฟล์รูปใบสั่งยา");
    if (file.size > MAX_BYTES) return bad("ไฟล์ใหญ่เกิน 10MB", 413);
    const mime = (file.type || "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_MIME.has(mime)) return bad("รับเฉพาะรูปภาพ (PNG/JPEG/WebP/GIF) หรือ PDF");
    // รูปใบสั่งยาเป็นข้อมูลสุขภาพ — private เสมอ (9.26)
    const row = await persistWebFile(file, undefined, "private");
    stored = {
      id: row.id,
      name: row.original_name ?? file.name ?? null,
      mimetype: row.mimetype ?? mime,
      size: row.size == null ? null : Number(row.size),
    };
  }

  const result = await addClinicalEvidence({
    tenantId: device.tenantId,
    assessmentId,
    kind,
    file: stored,
    textValue: fields.textValue ?? null,
    actorUserId: auth.userId,
    source: "pos",
  });

  if (result.status === "CASE_NOT_FOUND") return bad("ไม่พบเคสนี้ในร้านนี้", 404);
  if (result.status === "INVALID") return bad(result.reason);
  // ไม่คืนตัวหลักฐานกลับไปให้เครื่องขาย — เคาน์เตอร์เขียนได้ แต่ไม่มีสิทธิ์อ่าน
  return NextResponse.json({ status: "ADDED", id: result.evidence.id, kind: result.evidence.kind });
}

export const POST = withRouteErrorLog("POST /api/pos/pharmacy-evidence", handlePOST);
