// Next เรียกไฟล์นี้ครั้งเดียวตอน server เริ่มทำงาน (ทั้ง node และ edge)
//
// ตัว listener จริงอยู่ใน instrumentation.node.ts — import ต้องอยู่ "ข้างใน"
// เงื่อนไข NEXT_RUNTIME === "nodejs" เท่านั้น เพราะ webpack แทนค่าตัวแปรนี้ตอน
// build แล้วตัด branch ที่ไม่เข้าเงื่อนไขทิ้ง · ถ้า import ไว้ข้างนอก bundle ฝั่ง
// edge จะลาก pg เข้าไปด้วยแล้ว build ล้มด้วย module-not-found (fs/net)
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation.node");
  }
}
