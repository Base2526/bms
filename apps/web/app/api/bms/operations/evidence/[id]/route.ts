import { NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { loadPermissions } from "@/lib/bms/permissions";
import { checklistEvidenceFile } from "@/lib/bms/operationChecklistEvidence";
import { ChecklistError } from "@/lib/bms/operationChecklistPolicy";
import { withRouteErrorLog } from "@/lib/log/routeError";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handleGET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await authorizeAdminRoute("operations.checklist.view");
  if (!auth.ok)
    return NextResponse.json(
      { error: "unauthorized" },
      { status: auth.status },
    );
  try {
    const bytes = await checklistEvidenceFile(
      {
        tenantId: auth.tenantId,
        actorId: String(auth.adminId),
        permissions: await loadPermissions(auth.ctx),
      },
      Number(params.id),
    );
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof ChecklistError)
      return NextResponse.json({ error: "not found" }, { status: 404 });
    throw e;
  }
}
export const GET = withRouteErrorLog(
  "GET /api/bms/operations/evidence/[id]",
  handleGET,
);
