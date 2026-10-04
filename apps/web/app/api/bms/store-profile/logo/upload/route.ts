import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { buildFileUrlById, persistWebFile } from "@/lib/storage";
import { prepareStoreLogo } from "@/lib/bms/storeLogo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function handlePOST(req: NextRequest) {
  // Store profile mutations are admin-scoped rather than permission-scoped. Keep
  // the upload under the same boundary and derive the tenant from the session.
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

  let normalizedLogo: File;
  try {
    const bytes = await prepareStoreLogo(Buffer.from(await file.arrayBuffer()));
    normalizedLogo = new File([new Uint8Array(bytes)], "store-logo.png", { type: "image/png" });
  } catch {
    return NextResponse.json({ error: "อ่านรูปโลโก้ไม่ได้ กรุณาใช้ภาพนิ่ง PNG, JPG หรือ WebP ที่ไม่เสียและไม่เกิน 20 ล้านพิกเซล" }, { status: 400 });
  }

  try {
    // Receipts and public shop surfaces load the logo without an admin session.
    const row = await persistWebFile(normalizedLogo, undefined, "public", auth.tenantId);
    return NextResponse.json({
      url: buildFileUrlById(row.id),
      name: row.original_name ?? file.name ?? null,
      mimeType: row.mimetype ?? file.type ?? null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "upload failed" }, { status: 500 });
  }
}

export const POST = withRouteErrorLog("POST /api/bms/store-profile/logo/upload", handlePOST);
