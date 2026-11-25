import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { ClinicError } from "@/lib/bms/clinic/access";
import { readClinicAttachment, uploadClinicAttachment } from "@/lib/bms/clinic/attachments";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store, no-cache, max-age=0", "X-Content-Type-Options": "nosniff" };

function fail(error: unknown) {
  const status = error instanceof ClinicError ? error.status : 500;
  return NextResponse.json({ status: error instanceof ClinicError ? error.code : "CLINIC_UNAVAILABLE" },
    { status, headers: HEADERS });
}

async function handleGET(req: NextRequest) {
  const auth = await authorizeAdminRoute("clinic.record.read");
  if (!auth.ok) return NextResponse.json({ status: "FORBIDDEN" }, { status: auth.status, headers: HEADERS });
  try {
    const file = await readClinicAttachment({ tenantId: auth.tenantId, actorId: String(auth.adminId),
      attachmentId: req.nextUrl.searchParams.get("id") });
    return new NextResponse(new Uint8Array(file.content), { headers: {
      ...HEADERS, "Content-Type": file.mime_type,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
    } });
  } catch (error) { return fail(error); }
}

async function handlePOST(req: NextRequest) {
  const auth = await authorizeAdminRoute("clinic.record.write");
  if (!auth.ok) return NextResponse.json({ status: "FORBIDDEN" }, { status: auth.status, headers: HEADERS });
  const reader = req.body?.getReader();
  if (!reader) return NextResponse.json({ status: "INVALID_ATTACHMENT" }, { status: 400, headers: HEADERS });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 2 * 1024 * 1024) {
      await reader.cancel();
      return NextResponse.json({ status: "ATTACHMENT_TOO_LARGE" }, { status: 413, headers: HEADERS });
    }
    chunks.push(part.value);
  }
  try {
    const id = await uploadClinicAttachment({ tenantId: auth.tenantId, actorId: String(auth.adminId),
      encounterId: req.nextUrl.searchParams.get("encounterId"),
      fileName: req.headers.get("x-clinic-file-name"), mimeType: req.headers.get("content-type"),
      content: Buffer.concat(chunks) });
    return NextResponse.json({ status: "OK", id }, { headers: HEADERS });
  } catch (error) { return fail(error); }
}

export const GET = withRouteErrorLog("GET /api/bms/clinic/attachments", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/clinic/attachments", handlePOST);
