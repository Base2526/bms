// =============================================================
// ครอบ route handler ของ REST เพื่อให้ error ที่ไม่มีใครรับ "มีร่องรอย"
// -------------------------------------------------------------
// ปัญหาเดิม: route handler ของ App Router ที่ throw ออกมา Next จะตอบกลับเป็น
// 500 ที่ไม่มี body · ฝั่งจอเรียก res.json() แล้วได้ "Unexpected end of JSON
// input" ซึ่งอ่านแล้วเหมือนเน็ตหลุด ส่วนฝั่งเซิร์ฟเวอร์เหลือแค่บรรทัดใน stdout
// ของ container ที่ไม่มีใครเปิดดู — เคสจริงคือขายหน้าร้านไม่ได้ทั้งบิลแล้วไล่
// สาเหตุไม่ได้เลยเพราะไม่มีอะไรถูกบันทึกไว้
//
// Next 14 ยังไม่มี instrumentation `onRequestError` (มาใน 15) จึงต้องครอบราย
// route แทนการดักที่จุดเดียว
//
// สิ่งที่ทำ:
//   1. เขียนลง system_logs (โผล่ที่ /admin/logs · level=error เข้าเงื่อนไข Slack)
//   2. console.error ไว้เป็นทางถอยตอนฐานเองล่ม — เป็นกรณีเดียวที่ (1) ใช้ไม่ได้
//   3. ตอบ JSON เสมอ ให้จอมีอะไรอ่าน ไม่ใช่ body ว่าง
//
// ไม่ใส่ body/params ลง log: หลาย route ถือ PIN, token, ข้อมูลลูกค้า
// (writeLogServer redact เฉพาะ key ที่รู้จัก — เชื่อไม่ได้ว่าครอบคลุมทุกฟิลด์)
// =============================================================

import "server-only";

import crypto from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyAdminSession } from "@/lib/auth/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { writeLogServer } from "./writeLog.server";
import { ERROR_WINDOW_MS, shouldLog } from "./logThrottle";
import { isRestaurantCheckError } from "@/lib/bms/restaurantPosErrors";

type RouteHandler<Args extends any[]> = (...args: Args) => Promise<Response> | Response;

const SECRET_TEXT = /(Bearer\s+[A-Za-z0-9._~+\/-]+=*|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g;
function safeErrorText(value: unknown, max = 2_000): string | null {
  if (value == null) return null;
  return String(value).replace(SECRET_TEXT, "[REDACTED]").slice(0, max);
}

function errorSourceKey(args: unknown[]) {
  const req = args[0] as NextRequest | undefined;
  const posToken = req?.headers?.get?.("x-pos-device-token")?.trim();
  if (posToken) return `pos:${crypto.createHash("sha256").update(posToken).digest("hex").slice(0, 16)}`;
  const admin = verifyAdminSession();
  return admin?.id ? `admin:${admin.id}` : "anonymous";
}

async function resolveErrorTenant(args: unknown[]) {
  try {
    const admin = await authorizeAdminRoute(null);
    if (admin.ok) return admin.tenantId;
    const req = args[0] as NextRequest | undefined;
    const posToken = req?.headers?.get?.("x-pos-device-token")?.trim();
    if (!posToken) return null;
    const { authenticatePosDevice } = await import("@/lib/bms/pos");
    return (await authenticatePosDevice(posToken))?.tenantId ?? null;
  } catch {
    return null;
  }
}

/**
 * @param routeName เช่น "POST /api/pos/sale" — ใช้เป็น action/routeName ใน log
 */
export function withRouteErrorLog<Args extends any[]>(
  routeName: string,
  handler: RouteHandler<Args>
): (...args: Args) => Promise<Response> {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error: any) {
      // การปฏิเสธตามกฎธุรกิจไม่ใช่ "error ที่ไม่มีใครรับ" — ตอบ 409 พร้อมข้อความจริง
      // และ **ไม่เขียน log ระดับ error** เพราะมันคือคำตอบที่ตั้งใจ ไม่ใช่ระบบพัง
      //
      // ถ้าปล่อยให้ตกไปที่ 500 ด้านล่าง ข้อความจะถูก errorResponse() ลบทิ้งบน production
      // (เจอจริง: จอ POS ร้านอาหารขึ้น "เซิร์ฟเวอร์ผิดพลาด (เซิร์ฟเวอร์ผิดพลาด)" แล้วสั่งให้
      // กดชำระเงินซ้ำ ทั้งที่เหตุผลจริงคือใบจองถูกยกเลิกและกดกี่ครั้งก็ไม่ผ่าน) และ
      // system_logs จะเต็มไปด้วยกฎธุรกิจปกติจนกลบ error จริง
      if (isRestaurantCheckError(error)) {
        return NextResponse.json({ status: error.code, error: error.message }, { status: 409 });
      }
      const detail = {
        code: safeErrorText(error?.code, 80),             // SQLSTATE ถ้ามาจาก pg
        constraint: safeErrorText(error?.constraint, 160),
        detail: safeErrorText(error?.detail),
        message: safeErrorText(error?.message),
      };
      // console เขียนทุกครั้งเสมอ ไม่ throttle — เป็นทางถอยเดียวตอนฐานล่มจนเขียน
      // system_logs ไม่ได้ และไม่มีต้นทุนอะไรนอกจากบรรทัดใน stdout
      const safeStack = safeErrorText(error?.stack, 12_000);
      console.error(`[route] unhandled ${routeName}`, { ...detail, stack: safeStack });

      // error เดียวกันรัว ๆ (ฐานล่ม → ทุก request พังเหมือนกัน) ไม่ต้องเขียนทุกครั้ง
      // จำนวนครั้งยังนับครบที่ requestMetrics อยู่แล้ว
      const sourceKey = errorSourceKey(args);
      if (!shouldLog(`api|${sourceKey}|${routeName}|${detail.code ?? detail.message ?? ""}`, ERROR_WINDOW_MS)) {
        return errorResponse(detail.message);
      }

      // ไม่ await — ถ้าต้นเหตุคือฐานล่ม การรอเขียน log จะหน่วง response เปล่า ๆ
      // (writeLogServer กลืน error ของตัวเองอยู่แล้ว ไม่มีทาง throw กลับมา)
      void resolveErrorTenant(args).then((tenantId) => writeLogServer(
        "error",
        "api",
        `unhandled error: ${routeName}`,
        {
          action: "api.route.unhandled",
          status: "500",
          routeName,
          errorMessage: detail.message,
          stack: safeStack,
          sqlstate: detail.code,
          constraint: detail.constraint,
          detail: detail.detail,
          tenantId,
        }
      ));

      return errorResponse(detail.message);
    }
  };
}

function errorResponse(message: string | null) {
  const publicMessage = process.env.NODE_ENV === "production"
    ? "เซิร์ฟเวอร์ผิดพลาด"
    : (message ? String(message) : "เซิร์ฟเวอร์ผิดพลาด");
  return NextResponse.json(
    { status: "SERVER_ERROR", error: publicMessage },
    { status: 500 }
  );
}
