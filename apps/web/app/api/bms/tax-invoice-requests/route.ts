import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import {
  listTaxRequests,
  reviewTaxRequest,
  TaxRequestError,
} from "@/lib/bms/taxInvoiceRequests";
import {
  readRetailLocalJSON,
  RetailLocalRequestBodyError,
} from "@/lib/bms/retailLocalRequestBody";
import { taxRequestConfiguration } from "@/lib/bms/taxRequestToken";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  const status =
    error instanceof TaxRequestError ||
    error instanceof RetailLocalRequestBodyError
      ? error.status
      : (error as any)?.extensions?.code === "FORBIDDEN"
      ? 403
      : 500;
  return NextResponse.json(
    {
      error:
        status === 500
          ? "โหลดคำขอไม่สำเร็จ"
          : error instanceof Error
          ? error.message
          : "ไม่มีสิทธิ์",
    },
    { status, headers }
  );
}
export async function GET(req: NextRequest) {
  const auth = await authorizeAdminRoute("tax.document.view");
  if (!auth.ok)
    return NextResponse.json(
      { error: "unauthorized" },
      { status: auth.status, headers }
    );
  try {
    return NextResponse.json(
      await listTaxRequests(
        auth.ctx,
        req.nextUrl.searchParams.get("status") || "PENDING",
        Number(req.nextUrl.searchParams.get("offset") || 0)
      ),
      { headers }
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: NextRequest) {
  const auth = await authorizeAdminRoute("tax.document.issue");
  if (!auth.ok)
    return NextResponse.json(
      { error: "unauthorized" },
      { status: auth.status, headers }
    );
  const origin = req.headers.get("origin");
  if (
    !origin ||
    (origin !== req.nextUrl.origin &&
      origin !== taxRequestConfiguration().origin)
  )
    return NextResponse.json(
      { error: "invalid origin" },
      { status: 403, headers }
    );
  try {
    return NextResponse.json(
      await reviewTaxRequest(auth.ctx, (await readRetailLocalJSON(req)) as any),
      { headers }
    );
  } catch (error) {
    return failure(error);
  }
}
