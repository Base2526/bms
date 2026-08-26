// =============================================================
// GET /api/bms/pharmacy/evidence/[id]/file — รูปใบสั่งยาของเคส
// -------------------------------------------------------------
// เหตุผลที่ต้องมี route นี้แยก: `/api/files/[id]` ไม่ตรวจอะไรเลยและ id เป็นเลข
// เรียงลำดับ ใครก็ไล่เดาได้ รูปใบสั่งยาเป็นข้อมูลสุขภาพของคนที่ระบุตัวได้
// จึงต้องออกทางนี้เท่านั้น: ต้องมี session + สิทธิ์ pharmacy.evidence.read และ
// แถวหลักฐานต้องเป็นของ tenant ที่ล็อกอินอยู่จริง
//
// client ไม่เคยเห็น files.id เลย — เห็นแต่ evidence UUID
// =============================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Readable } from "stream";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { getEvidenceFileForStreaming } from "@/lib/bms/pharmacy/clinicalEvidence";
import { openStoredFileStream, statStoredFile } from "@/lib/storage";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// เปิดดูในเบราว์เซอร์ได้เฉพาะชนิดที่ปลอดภัย — svg/html แสดง inline แล้วรัน
// script ในบริบทโดเมนเราได้ ใบสั่งยาไม่มีเหตุผลต้องเป็น svg
const INLINE_SAFE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);

async function handleGET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdminRoute("pharmacy.evidence.read");
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "unauthorized" : "forbidden" },
      { status: auth.status }
    );
  }

  const id = String(params.id ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  // tenant มาจาก session/คุกกี้ drill-down เท่านั้น ห้ามรับจาก client
  const found = await getEvidenceFileForStreaming(auth.tenantId, id);
  if (!found) return NextResponse.json({ error: "not found" }, { status: 404 });

  const stored = await statStoredFile(found.relpath);
  if (!stored) return NextResponse.json({ error: "file missing in storage" }, { status: 404 });

  const mime = (found.mimetype || "").split(";")[0].trim().toLowerCase();
  const safeMime = INLINE_SAFE.has(mime) ? mime : "application/octet-stream";
  const disposition = INLINE_SAFE.has(mime) ? "inline" : "attachment";
  const name = (found.name || `evidence-${id}`).replace(/[\/\\?%*:|"<>]/g, "_");

  const nodeStream = await openStoredFileStream(found.relpath);
  return new NextResponse(Readable.toWeb(nodeStream) as any, {
    status: 200,
    headers: {
      "Content-Type": safeMime,
      "Content-Length": String(stored.size),
      // ห้าม cache ข้อมูลสุขภาพ — ต่างจาก /api/files ที่ตั้ง public,immutable
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition":
        `${disposition}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      // กัน content sniffing ให้เบราว์เซอร์ไม่เดาชนิดเป็นอย่างอื่น
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const GET = withRouteErrorLog("GET /api/bms/pharmacy/evidence/[id]/file", handleGET);
