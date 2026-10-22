import { NextRequest, NextResponse } from "next/server";
import {
  getCheckoutByToken,
  saveCheckoutDeliveryByToken,
} from "@/lib/bms/checkout";
import { audit } from "@/lib/bms/audit";
import { withRouteErrorLog } from "@/lib/log/routeError";
import { readRetailLocalJSON, RetailLocalRequestBodyError } from "@/lib/bms/retailLocalRequestBody";
import { requireCheckoutRateLimit } from "./routeHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function handleGET(req: NextRequest) {
  const limited = await requireCheckoutRateLimit(req, "read");
  if (limited) return limited;
  const token = new URL(req.url).searchParams.get("t") || "";
  const tokenLimited = await requireCheckoutRateLimit(req, "read", token);
  if (tokenLimited) return tokenLimited;
  const result = await getCheckoutByToken(token);
  return result.ok
    ? response({ checkout: result.checkout })
    : response({ error: result.reason }, 404);
}

async function handlePATCH(req: NextRequest) {
  const limited = await requireCheckoutRateLimit(req, "delivery");
  if (limited) return limited;
  let parsed: unknown;
  try {
    parsed = await readRetailLocalJSON(req, 16 * 1024);
  } catch (error) {
    if (error instanceof RetailLocalRequestBodyError) {
      return response({ error: "ข้อมูลที่ส่งมาไม่ถูกต้องหรือมีขนาดใหญ่เกินไป" }, error.status);
    }
    throw error;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return response({ error: "ข้อมูลที่ส่งมาไม่ถูกต้อง" }, 400);
  }
  const body = parsed as Record<string, unknown>;
  const token = typeof body.token === "string" ? body.token : "";
  if (!token) return response({ error: "ไม่พบ checkout token" }, 400);
  const tokenLimited = await requireCheckoutRateLimit(req, "delivery", token);
  if (tokenLimited) return tokenLimited;

  try {
    const result = await saveCheckoutDeliveryByToken(token, {
      recipientName:
        typeof body.recipientName === "string" ? body.recipientName : null,
      phone: typeof body.phone === "string" ? body.phone : null,
      shippingAddress:
        typeof body.shippingAddress === "string" ? body.shippingAddress : null,
      addressLabel:
        typeof body.addressLabel === "string" ? body.addressLabel : null,
      provinceCode: typeof body.provinceCode === "string" ? body.provinceCode : null,
      districtCode: typeof body.districtCode === "string" ? body.districtCode : null,
      subdistrictCode: typeof body.subdistrictCode === "string" ? body.subdistrictCode : null,
      postcode: typeof body.postcode === "string" ? body.postcode : null,
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
