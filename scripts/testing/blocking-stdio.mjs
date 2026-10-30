// =============================================================
// stdout/stderr แบบ blocking สำหรับตัวรันเทส — กันผลเทสหายเงียบ ๆ ตอน --test-force-exit
// -------------------------------------------------------------
// ตัวรันใช้ `--test-force-exit` ซึ่งทำให้ "ลูก" ของแต่ละไฟล์เทสเรียก process.exit() ทันทีที่
// reporter ปล่อยสตรีม (node:internal/test_runner/test → Test.run) · ลูกส่งผลเทสกลับหาพ่อผ่าน
// stdout ที่เป็น pipe และบน macOS/Windows การเขียนลง pipe เป็นแบบ async — ข้อมูลที่ยังค้างคิว
// ใน libuv ตอน exit ถูกทิ้งทั้งก้อน
//
// อาการที่เจอจริง (2026-10-30): `pharmacy-customer-assistance-contract` รายงาน 173 / 198 /
// 181 / 211 เทสในสี่รอบติดกัน **ผ่านทุกรอบ fail 0** · เทสที่หายคือท้ายไฟล์ทั้งหมด (รวมชุด
// pipeline/intake ของด่านร้านยา) · วัดที่ลูกตอน exit ได้ writeQueueSize 304–410 และค้าง 4–59 KB
// ทุกรอบที่หาย และ 0 ทุกรอบที่ครบ · Linux (CI) เขียน pipe แบบ sync จึงไม่โดน — แต่ gate
// ในเครื่องที่ใช้ยืนยันงานก่อนส่งโดน
//
// ทางแก้คือทำ pipe ให้ blocking ทั้งพ่อและลูก (preload ตัวนี้ถูกส่งต่อเข้าลูกผ่าน --import)
// ไม่ถอด `--test-force-exit` เพราะไฟล์เทสที่ทิ้ง handle ค้าง (Redis/pg pool) จะทำให้ทั้ง gate ค้าง
//
// ด่านสำรอง: ถ้าวันหนึ่ง setBlocking ใช้ไม่ได้ (Node เปลี่ยน API ภายใน) แล้วยังมีข้อมูลค้างตอน
// exit — เปลี่ยน exit code เป็น 1 และเขียนเหตุผลลง stderr แบบ sync · "หายแล้วผ่าน" แย่กว่า "แดง"
// =============================================================

import { writeSync } from "node:fs";

const streams = [
  { name: "stdout", stream: process.stdout },
  { name: "stderr", stream: process.stderr },
];

for (const { stream } of streams) {
  // ไฟล์และ TTY บน macOS/Linux เป็น sync อยู่แล้ว · ที่ต้องแก้คือ pipe
  if (stream._type === "pipe" && typeof stream._handle?.setBlocking === "function") {
    stream._handle.setBlocking(true);
  }
}

process.on("exit", (code) => {
  const pending = streams.filter(({ stream }) => stream._type === "pipe" && stream.writableLength > 0);
  if (pending.length === 0) return;
  const detail = pending.map(({ name, stream }) => `${name} ${stream.writableLength} bytes`).join(", ");
  try {
    writeSync(2, `\n[blocking-stdio] process ${process.pid} exited with unflushed ${detail}; test results were lost — failing this run.\n`);
  } catch {
    // stderr เองอาจเป็นตัวที่ค้าง — exit code ด้านล่างยังทำงาน
  }
  if (!code) process.exitCode = 1;
});
