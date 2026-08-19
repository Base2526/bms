// apps/web/app/api/bms/products/upload/route.ts
// อัปโหลดรูปสินค้า → เก็บลง storage → คืน { url, name, mimeType }
// จากนั้น client ใส่ url ลง BmsProductInput.image_url ตอน bmsUpsertProduct (gate product.edit ที่ resolver)
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminOrInternal } from "@/lib/dev-guards";
import { persistWebFile, buildFileUrlById } from "@/lib/storage";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024; // 10MB

async function handlePOST(req: NextRequest) {
  const guard = requireAdminOrInternal(req);
  if (!guard.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });
  if (!file.type?.startsWith("image/")) return NextResponse.json({ error: "ต้องเป็นไฟล์รูปภาพ" }, { status: 400 });
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

export const POST = withRouteErrorLog("POST /api/bms/products/upload", handlePOST);
