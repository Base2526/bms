import { NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { loadPermissions } from "@/lib/bms/permissions";
import { ChecklistError } from "@/lib/bms/operationChecklistPolicy";
import {
  uploadChecklistEvidence,
  CHECKLIST_IMAGE_MAX_BYTES,
} from "@/lib/bms/operationChecklistEvidence";
import { withRouteErrorLog } from "@/lib/log/routeError";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handlePOST(req: Request) {
  const auth = await authorizeAdminRoute("operations.checklist.execute");
  if (!auth.ok)
    return NextResponse.json({ status: "FORBIDDEN" }, { status: auth.status });
  // Raw image body, bounded even without Content-Length. Query contains resource identity only.
  const reader = req.body?.getReader();
  if (!reader)
    return NextResponse.json({ status: "INVALID_INPUT" }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.length;
    if (size > CHECKLIST_IMAGE_MAX_BYTES) {
      await reader.cancel();
      return NextResponse.json({ status: "TOO_LARGE" }, { status: 413 });
    }
    chunks.push(r.value);
  }
  const params = new URL(req.url).searchParams;
  try {
    const result = await uploadChecklistEvidence(
      {
        tenantId: auth.tenantId,
        actorId: String(auth.adminId),
        permissions: await loadPermissions(auth.ctx),
      },
      params.get("runId") ?? "",
      params.get("itemKey") ?? "",
      Number(params.get("version")),
      Buffer.concat(chunks),
    );
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ChecklistError)
      return NextResponse.json(
        { status: e.status },
        {
          status:
            e.status === "FORBIDDEN"
              ? 403
              : e.status === "NOT_FOUND"
                ? 404
                : 409,
        },
      );
    throw e;
  }
}
export const POST = withRouteErrorLog(
  "POST /api/bms/operations/evidence",
  handlePOST,
);
