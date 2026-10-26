import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { buildFileUrlById, persistWebFile } from "@/lib/storage";
import { prepareCustomerDisplayBackground } from "@/lib/bms/storeLogo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute(null);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "unauthorized" : "forbidden" },
      { status: auth.status }
    );
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: "รองรับเฉพาะไฟล์ PNG, JPG และ WebP" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "ไฟล์ใหญ่เกิน 5MB" }, { status: 413 });
  }

  let normalizedBackground: File;
  try {
    const bytes = await prepareCustomerDisplayBackground(Buffer.from(await file.arrayBuffer()));
    normalizedBackground = new File([new Uint8Array(bytes)], "customer-display-background.webp", { type: "image/webp" });
  } catch {
    return NextResponse.json({ error: "อ่านรูปพื้นหลังไม่ได้ กรุณาใช้ภาพนิ่ง PNG, JPG หรือ WebP ที่ไม่เสียและไม่เกิน 20 ล้านพิกเซล" }, { status: 400 });
  }

  try {
    // The paired POS customer display loads this image without an admin session.
    const row = await persistWebFile(normalizedBackground, undefined, "public", auth.tenantId);
    return NextResponse.json({
      url: buildFileUrlById(row.id),
      name: row.original_name ?? file.name ?? null,
      mimeType: row.mimetype ?? file.type ?? null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "upload failed" }, { status: 500 });
  }
}

export const POST = withRouteErrorLog("POST /api/bms/store-profile/customer-display-background/upload", handlePOST);
