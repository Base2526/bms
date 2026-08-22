import { NextRequest, NextResponse } from "next/server";
import {
  getCheckoutByToken,
  submitCheckoutPaymentByToken,
} from "@/lib/bms/checkout";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/bms/payments";
import { audit } from "@/lib/bms/audit";
import { buildFileUrlById, persistWebFile } from "@/lib/storage";
import sharp, { type Metadata } from "sharp";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SLIP_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_SLIP_BYTES + 1024 * 1024;
const MAX_SLIP_PIXELS = 24_000_000;
const SLIP_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SLIP_FORMATS = new Set(["jpeg", "png", "webp"]);

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function handlePOST(req: NextRequest) {
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return response({ error: "รูปสลิปต้องมีขนาดไม่เกิน 8 MB" }, 413);
  }
  const form = await req.formData().catch(() => null);
  if (!form) return response({ error: "ข้อมูลที่ส่งมาไม่ถูกต้อง" }, 400);

  const token = String(form.get("token") || "");
  const method = String(form.get("method") || "") as PaymentMethod;
  const slipRef = String(form.get("slipRef") || "").trim() || null;
  const file = form.get("slip");

  if (!token) return response({ error: "ไม่พบ checkout token" }, 400);
  if (
    !PAYMENT_METHODS.includes(method) ||
    !["BANK_TRANSFER", "QR"].includes(method)
  ) {
    return response({ error: "ช่องทางชำระเงินไม่ถูกต้อง" }, 400);
  }

  const current = await getCheckoutByToken(token);
  if (!current.ok) return response({ error: current.reason }, 404);
  if (
    current.checkout.payment.latest?.status === "PENDING" ||
    current.checkout.payment.latest?.status === "CONFIRMED"
  ) {
    return response({
      status: "ALREADY_SUBMITTED",
      checkout: current.checkout,
    });
  }
  if (current.checkout.delivery.marketplaceManaged) {
    return response({ error: "ออร์เดอร์นี้ชำระเงินผ่าน Seller Center" }, 400);
  }
  if (!current.checkout.delivery.complete) {
    return response({ error: "กรุณากรอกข้อมูลจัดส่งที่ยังขาดก่อน" }, 400);
  }
  if (current.checkout.order.status !== "PENDING") {
    return response({ error: "ออร์เดอร์นี้ไม่อยู่ในสถานะรอชำระเงิน" }, 400);
  }
  if (
    !current.checkout.payment.accounts.some(
      (account) => account.method === method
    )
  ) {
    return response(
      { error: "ช่องทางชำระเงินนี้ไม่ได้ถูกตั้งค่าไว้สำหรับร้าน" },
      400
    );
  }

  if (!(file instanceof File) || file.size === 0) {
    return response({ error: "กรุณาแนบรูปสลิป" }, 400);
  }
  if (!SLIP_TYPES.has(file.type)) {
    return response({ error: "รองรับสลิป JPG, PNG หรือ WEBP เท่านั้น" }, 400);
  }
  if (file.size > MAX_SLIP_BYTES) {
    return response({ error: "รูปสลิปต้องมีขนาดไม่เกิน 8 MB" }, 400);
  }

  try {
    let metadata: Metadata;
    try {
      const image = sharp(Buffer.from(await file.arrayBuffer()), {
        limitInputPixels: MAX_SLIP_PIXELS,
      });
      metadata = await image.metadata();
    } catch {
      return response({ error: "ไฟล์สลิปไม่ใช่รูปภาพที่รองรับ" }, 400);
    }
    if (
      !metadata.format ||
      !SLIP_FORMATS.has(metadata.format) ||
      !metadata.width ||
      !metadata.height
    ) {
      return response({ error: "ไฟล์สลิปไม่ใช่รูปภาพที่รองรับ" }, 400);
    }
    const stored = await persistWebFile(
      file,
      `checkout-${current.checkout.order.displayId}-${file.name}`
    );
    const result = await submitCheckoutPaymentByToken(token, {
      method,
      slipUrl: buildFileUrlById(stored.id),
      slipRef,
    });
    if (!result.ok) return response({ error: result.reason }, 400);
    if (!("paymentId" in result.result)) {
      return response({ error: "บันทึกการแจ้งชำระไม่สำเร็จ" }, 400);
    }

    await audit(
      {
        tenant_id: current.payload.tenantId,
        admin: { email: "customer:checkout" },
      },
      "payment.submit",
      result.result.paymentId,
      {
        orderId: current.checkout.order.id,
        method,
        source: "public_checkout",
      }
    );
    return response(
      {
        status: result.result.status,
        checkout: result.checkout,
      },
      result.result.status === "SUBMITTED" ? 201 : 200
    );
  } catch (error) {
    console.error("[BMS] checkout payment upload failed:", error);
    return response({ error: "แจ้งชำระไม่สำเร็จ กรุณาลองอีกครั้ง" }, 500);
  }
}

export const POST = withRouteErrorLog("POST /api/bms/checkout/payment", handlePOST);
