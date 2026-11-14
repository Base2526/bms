import { NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { rateLimit } from "@/lib/bms/rateLimit";
import { DELIVERY_DISPUTE_IMAGE_MAX_BYTES, uploadDeliveryDisputeEvidence } from "@/lib/bms/deliveryDisputeEvidence";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePOST(req: Request) {
  const auth = await authorizeAdminRoute("delivery.dispute.manage");
  if (!auth.ok) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: auth.status });
  const limited = await rateLimit(`delivery-dispute-evidence:${auth.tenantId}:${auth.adminId}`, 20, 60_000);
  if (!limited.ok) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  const disputeId = new URL(req.url).searchParams.get("disputeId") ?? "";
  const reader = req.body?.getReader();
  if (!reader) return NextResponse.json({ error: "DELIVERY_DISPUTE_EVIDENCE_INVALID" }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > DELIVERY_DISPUTE_IMAGE_MAX_BYTES) {
      await reader.cancel();
      return NextResponse.json({ error: "DELIVERY_DISPUTE_EVIDENCE_TOO_LARGE" }, { status: 413 });
    }
    chunks.push(part.value);
  }
  try {
    const result = await uploadDeliveryDisputeEvidence({
      tenantId: auth.tenantId, actorUserId: String(auth.adminId), disputeId,
      bytes: Buffer.concat(chunks),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "DELIVERY_DISPUTE_EVIDENCE_INVALID";
    if (!code.startsWith("DELIVERY_DISPUTE_")) throw error;
    return NextResponse.json({ error: code }, { status: code.includes("NOT_FOUND") ? 404 : code.includes("CLOSED") || code.includes("LIMIT") ? 409 : 400 });
  }
}

export const POST = withRouteErrorLog("POST /api/bms/delivery/disputes/evidence", handlePOST);
