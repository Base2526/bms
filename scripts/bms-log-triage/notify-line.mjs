// =============================================================
// BMS log triage — LINE notification (Messaging API push)
// -------------------------------------------------------------
// แจ้งเตือนทีมผ่าน LINE เมื่อ triage เปิด draft PR
// * ใช้ LINE Messaging API push (LINE Notify ปิดบริการแล้ว มี.ค. 2025)
//
// ENV:
//   LINE_OPS_TOKEN  — Channel access token ของ LINE OA สำหรับทีม (ops)
//   LINE_OPS_TO     — userId / groupId ปลายทาง (ที่ให้ OA push ไปหา)
//   LINE_MESSAGE    — ข้อความ (หรือส่งเป็น argv)
//
// หมายเหตุ: ถ้าไม่ตั้ง secret หรือ push พลาด → exit 0 (ไม่ทำให้ workflow ล้ม)
// =============================================================

const token = process.env.LINE_OPS_TOKEN;
const to = process.env.LINE_OPS_TO;
const message = (process.env.LINE_MESSAGE || process.argv.slice(2).join(" ")).trim();

if (!token || !to) {
  console.log("ℹ️ LINE_OPS_TOKEN / LINE_OPS_TO ไม่ได้ตั้ง — ข้ามการแจ้งเตือน");
  process.exit(0);
}
if (!message) {
  console.log("ℹ️ ไม่มีข้อความ — ข้าม");
  process.exit(0);
}

try {
  const resp = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: [{ type: "text", text: message.slice(0, 4900) }] }),
  });
  if (!resp.ok) {
    console.error(`⚠️ LINE push failed ${resp.status}: ${await resp.text()}`);
    process.exit(0); // ไม่ fail workflow เพราะแจ้งเตือนพลาด
  }
  console.log("✅ LINE notified");
} catch (e) {
  console.error("⚠️ LINE push error:", e?.message || e);
  process.exit(0);
}
