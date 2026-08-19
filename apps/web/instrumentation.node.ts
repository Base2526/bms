// =============================================================
// จับ error ระดับ process ที่ไม่มี request ให้ตอบกลับ (Node runtime เท่านั้น)
// -------------------------------------------------------------
// แยกไฟล์ออกจาก instrumentation.ts เพราะ Next build instrumentation ทั้งฝั่ง
// node และ edge · ไฟล์นี้ import pg (ผ่าน writeLog.server) ซึ่ง bundle ฝั่ง edge
// ไม่มี fs/net ให้ — ต้องให้ import อยู่ใน if (NEXT_RUNTIME === "nodejs") เท่านั้น
// webpack ถึงจะตัดทิ้งตอน build edge
//
// error ที่หลุดจาก background task (fire-and-forget: ส่งอีเมล, push ช่องทาง,
// เขียน log, งาน cron ที่ไม่ await) ไม่มี route handler ไหนครอบถึง — เดิมจึงหาย
// ไปกับ stdout หรือทำให้ process ตายเงียบ ๆ
// =============================================================

import { writeLogServer } from "@/lib/log/writeLog.server";

const describe = (err: any) => ({
  errorMessage: err?.message ? String(err.message) : String(err),
  stack: err?.stack ?? null,
  sqlstate: err?.code ?? null,
});

process.on("unhandledRejection", (reason: any) => {
  console.error("[process] unhandledRejection", reason);
  void writeLogServer("error", "process", "unhandled promise rejection", {
    action: "process.unhandled_rejection",
    ...describe(reason),
  });
});

// uncaughtExceptionMonitor (ไม่ใช่ uncaughtException) ตั้งใจเลือกเพราะเป็น
// listener แบบ "ดูอย่างเดียว" — Node ยังทำงานต่อตามพฤติกรรมเดิมทุกอย่าง (คือ
// crash) การใส่ uncaughtException จะกลืน crash ไว้แล้วปล่อยให้ process วิ่งต่อ
// ทั้งที่ state พังแล้ว ซึ่งอันตรายกว่าการตายให้ orchestrator restart
process.on("uncaughtExceptionMonitor", (err) => {
  console.error("[process] uncaughtException", err);
  // เขียนแบบ fire-and-forget เท่าที่ทัน — process กำลังจะตายตามพฤติกรรมเดิมของ
  // Node ถ้าเขียนไม่ทันก็ยังเหลือบรรทัดข้างบนใน stdout
  void writeLogServer("error", "process", "uncaught exception", {
    action: "process.uncaught_exception",
    ...describe(err),
  });
});
