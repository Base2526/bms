import { NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { readDeliveryDisputeEvidence } from "@/lib/bms/deliveryDisputeEvidence";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authorizeAdminRoute("delivery.settlement.view");
  if (!auth.ok) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: auth.status });
  try {
    const bytes = await readDeliveryDisputeEvidence(auth.tenantId, Number(params.id));
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/webp",
        "Content-Disposition": `attachment; filename="delivery-dispute-evidence-${params.id}.webp"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "DELIVERY_DISPUTE_EVIDENCE_NOT_FOUND") {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    throw error;
  }
}

export const GET = withRouteErrorLog("GET /api/bms/delivery/disputes/evidence/[id]", handleGET);
