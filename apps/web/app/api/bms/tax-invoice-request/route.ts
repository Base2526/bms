import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/bms/rateLimit";
import {
  readRetailLocalJSON,
  RetailLocalRequestBodyError,
} from "@/lib/bms/retailLocalRequestBody";
import {
  inspectTaxReceipt,
  submitTaxRequest,
  trackTaxRequest,
  reviseTaxRequest,
  recoverTaxRequest,
  TaxRequestError,
} from "@/lib/bms/taxInvoiceRequests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
/** Public by design: purpose-bound receipt capability / private tracking secret, never session authority. */
export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ipLimit = await rateLimit(`tax-request:ip:${ip}`, 60, 60_000);
  if (!ipLimit.ok)
    return NextResponse.json(
      { error: "กรุณารอสักครู่แล้วลองใหม่" },
      {
        status: 429,
        headers: { ...headers, "Retry-After": String(ipLimit.retryAfter) },
      }
    );
  try {
    const body = (await readRetailLocalJSON(req, 8192)) as any;
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new TaxRequestError("ข้อมูลไม่ถูกต้อง");
    const credential = ["track", "revise"].includes(body.action)
      ? body.access
      : body.token;
    if (typeof credential !== "string" || credential.length > 250)
      throw new TaxRequestError("ลิงก์ไม่ถูกต้อง");
    const limited = await rateLimit(
      `tax-request:token:${createHash("sha256")
        .update(credential)
        .digest("hex")}`,
      20,
      60_000
    );
    if (!limited.ok)
      return NextResponse.json(
        { error: "กรุณารอสักครู่แล้วลองใหม่" },
        {
          status: 429,
          headers: { ...headers, "Retry-After": String(limited.retryAfter) },
        }
      );
    let result;
    switch (body.action) {
      case "inspect":
        result = await inspectTaxReceipt(body.token);
        break;
      case "submit":
        result = await submitTaxRequest(
          body.token,
          body.buyer,
          body.accessSecret
        );
        break;
      case "recover":
        result = await recoverTaxRequest(body.token, body.accessSecret);
        break;
      case "track":
        result = await trackTaxRequest(body.access);
        break;
      case "revise":
        result = await reviseTaxRequest(body.access, body.version, body.buyer);
        break;
      default:
        throw new TaxRequestError("คำสั่งไม่ถูกต้อง");
    }
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (
      error instanceof TaxRequestError ||
      error instanceof RetailLocalRequestBodyError
    )
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers }
      );
    // Do not log tokens, buyer identity, request bodies, or driver errors containing bound PII.
    return NextResponse.json(
      { error: "ดำเนินการไม่สำเร็จ กรุณาตรวจลิงก์หรือติดต่อร้าน" },
      { status: 400, headers }
    );
  }
}
