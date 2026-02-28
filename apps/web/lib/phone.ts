// ===== helpers/phone.ts =====
export function normalizePhone(raw: string): string {
  if (!raw) return "";
  // ตัดทุกอย่างที่ไม่ใช่ตัวเลข
  let d = String(raw).replace(/[^\d]/g, "");

  // ตัวอย่าง normalize ไทย: ถ้าเริ่ม 66 แล้วเหลือ 9-10 หลัก -> แปลงเป็น 0xxxxxxxxx
  // (ปรับตามจริงของคุณได้)
  if (d.startsWith("66") && d.length >= 11) {
    d = "0" + d.slice(2);
  }

  // ถ้าเป็น 0 นำหน้าอยู่แล้วก็ใช้ต่อ
  return d;
}

function calcRiskLocal(blocked: number, report: number) {
  let score = blocked * 4 + report * 6;
  if (score > 100) score = 100;
  if (score < 0) score = 0;
  return score;
}

export function normalizeAccountNo(raw: string): string {
  return String(raw || "").replace(/\D+/g, ""); // เอาเฉพาะตัวเลข
}
