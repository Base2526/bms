// =============================================================
// การ์ดของ endpoint ที่ตัวตั้งเวลาเรียก (cron/job)
// -------------------------------------------------------------
// เดิมทุก route เขียนเองว่า:
//
//   const secret = process.env.BMS_CRON_SECRET;
//   if (secret && req.headers.get("x-cron-secret") !== secret) → 401
//
// `secret &&` ทำให้ **ไม่ตั้ง env = ไม่ตรวจอะไรเลย** ซึ่งเป็นสถานะจริงของระบบนี้
// (CLAUDE.local.md จดไว้เองว่า BMS_CRON_SECRET ยังไม่ได้ตั้ง) ผลคือใครก็ยิง
// endpoint ที่ส่งอีเมลออกจริง จ่ายค่า AI ปล่อยสต็อกที่จองไว้ หรือทำแต้มลูกค้า
// หมดอายุได้ · เป็น fail-open แบบเดียวกับที่ถูกกำจัดไปแล้วจากเรื่อง secret
//
// helper นี้ fail closed: ไม่ตั้ง env = ปฏิเสธทุกคำขอ (503 เพราะเป็นการตั้งค่า
// ที่ยังไม่เสร็จ ไม่ใช่ผู้เรียกผิด) · ตั้งแล้วแต่ส่ง header ไม่ตรง = 401
//
// ผลข้างเคียงที่ตั้งใจ: ถ้ายังไม่ตั้ง secret งานตั้งเวลาจะไม่ทำงานและเห็นชัดว่า
// ไม่ทำงาน ดีกว่าเปิดให้ใครก็ยิงได้เงียบ ๆ
// =============================================================

import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

export type CronAuthFailure = { ok: false; response: NextResponse };
export type CronAuthResult = { ok: true } | CronAuthFailure;

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * @param headerName ชื่อ header ที่พา secret มา
 * @param envName    ชื่อ env ที่เก็บค่าที่ถูกต้อง
 */
export function authorizeCronRequest(
  req: Request,
  headerName = "x-cron-secret",
  envName = "BMS_CRON_SECRET"
): CronAuthResult {
  const expected = process.env[envName];
  if (!expected) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `${envName} is not configured — refusing to run a scheduled job on an unauthenticated request`,
        },
        { status: 503 }
      ),
    };
  }
  const provided = req.headers.get(headerName) ?? "";
  if (!provided || !safeEqual(provided, expected)) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  return { ok: true };
}
