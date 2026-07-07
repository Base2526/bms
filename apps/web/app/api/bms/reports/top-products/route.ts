// GET /api/bms/reports/top-products?from=&to=&limit=   [Phase 1: default tenant]
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getTopSellingProducts } from "@/lib/bms/reports";
import { DEFAULT_TENANT_ID } from "@/lib/bms/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rows = await getTopSellingProducts(
    DEFAULT_TENANT_ID,
    url.searchParams.get("from"),
    url.searchParams.get("to"),
    Number(url.searchParams.get("limit")) || 10
  );
  return NextResponse.json({ products: rows });
}
