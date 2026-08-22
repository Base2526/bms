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

import { NextResponse } from "next/server";
import { writeLogServer } from "./writeLog.server";
import { ERROR_WINDOW_MS, shouldLog } from "./logThrottle";

type RouteHandler<Args extends any[]> = (...args: Args) => Promise<Response> | Response;

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
      const detail = {
        code: error?.code ?? null,             // SQLSTATE ถ้ามาจาก pg
        constraint: error?.constraint ?? null,
        detail: error?.detail ?? null,
        message: error?.message ?? null,
      };
      // console เขียนทุกครั้งเสมอ ไม่ throttle — เป็นทางถอยเดียวตอนฐานล่มจนเขียน
      // system_logs ไม่ได้ และไม่มีต้นทุนอะไรนอกจากบรรทัดใน stdout
      console.error(`[route] unhandled ${routeName}`, { ...detail, stack: error?.stack ?? null });

      // error เดียวกันรัว ๆ (ฐานล่ม → ทุก request พังเหมือนกัน) ไม่ต้องเขียนทุกครั้ง
      // จำนวนครั้งยังนับครบที่ requestMetrics อยู่แล้ว
      if (!shouldLog(`api|${routeName}|${detail.code ?? detail.message ?? ""}`, ERROR_WINDOW_MS)) {
        return errorResponse(detail.message);
      }

      // ไม่ await — ถ้าต้นเหตุคือฐานล่ม การรอเขียน log จะหน่วง response เปล่า ๆ
      // (writeLogServer กลืน error ของตัวเองอยู่แล้ว ไม่มีทาง throw กลับมา)
      void writeLogServer("error", "api", `unhandled error: ${routeName}`, {
        action: "api.route.unhandled",
        status: "500",
        routeName,
        errorMessage: detail.message,
        stack: error?.stack ?? null,
        sqlstate: detail.code,
        constraint: detail.constraint,
        detail: detail.detail,
      });

      return errorResponse(detail.message);
    }
  };
}

function errorResponse(message: string | null) {
  return NextResponse.json(
    { status: "SERVER_ERROR", error: message ? String(message) : "เซิร์ฟเวอร์ผิดพลาด" },
    { status: 500 }
  );
}
