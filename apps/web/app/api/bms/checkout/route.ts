import { NextRequest, NextResponse } from "next/server";
import {
  getCheckoutByToken,
  saveCheckoutDeliveryByToken,
} from "@/lib/bms/checkout";
import { audit } from "@/lib/bms/audit";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function handleGET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("t") || "";
  const result = await getCheckoutByToken(token);
  return result.ok
    ? response({ checkout: result.checkout })
    : response({ error: result.reason }, 404);
}

async function handlePATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const token = typeof body.token === "string" ? body.token : "";
  if (!token) return response({ error: "ไม่พบ checkout token" }, 400);

  try {
    const result = await saveCheckoutDeliveryByToken(token, {
      recipientName:
        typeof body.recipientName === "string" ? body.recipientName : null,
      phone: typeof body.phone === "string" ? body.phone : null,
      shippingAddress:
        typeof body.shippingAddress === "string" ? body.shippingAddress : null,
      addressLabel:
        typeof body.addressLabel === "string" ? body.addressLabel : null,
    });
    if (!result.ok) return response({ error: result.reason }, 400);

    await audit(
      {
        tenant_id: result.payload.tenantId,
        admin: { email: "customer:checkout" },
      },
      "customer.checkout_update",
      result.checkout.order.id,
      { source: "public_checkout" }
    );
    return response({ checkout: result.checkout });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "บันทึกข้อมูลจัดส่งไม่สำเร็จ";
    return response({ error: message }, 400);
  }
}

export const GET = withRouteErrorLog("GET /api/bms/checkout", handleGET);
export const PATCH = withRouteErrorLog("PATCH /api/bms/checkout", handlePATCH);
