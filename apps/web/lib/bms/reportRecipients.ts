// Multi-recipient parsing/validation for report subscriptions (email/Slack webhook/LINE user id).
// แยกไฟล์นี้ออกมาเพราะ "ไม่แตะ @/lib/db" — client component (ReportSubscriptionCard.tsx) import
// ตรงได้เพื่อ validate ก่อน submit เหมือน pattern เดียวกับ productImport.constants.ts
// ผู้รับหลายคนต่อช่องทาง เก็บเป็น string เดียวคั่นด้วย "," ในคอลัมน์ TEXT เดิม (ไม่มี migration)

// TLD (ส่วนสุดท้ายหลังจุดตัวสุดท้าย) ต้องเป็นตัวอักษร ASCII ล้วนความยาว >=2 — กัน "a@b.comมพพพ" หลุดผ่าน
// (regex เดิม [^\s@]+ ท้ายสุดกว้างเกินไป ยอมรับ unicode ต่อท้าย TLD ที่ถูกต้องได้)
export const EMAIL_RE = /^[^\s@]+@([^\s@]+\.)+[a-zA-Z]{2,}$/;
export const LINE_USER_ID_RE = /^U[0-9a-fA-F]{32}$/;

export function parseRecipientList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return Array.from(new Set(raw.split(",").map((s) => s.trim()).filter(Boolean)));
}

export function invalidEmails(list: string[]): string[] {
  return list.filter((e) => !EMAIL_RE.test(e));
}

export function invalidSlackWebhookUrls(list: string[]): string[] {
  return list.filter((url) => {
    try {
      return new URL(url).protocol !== "https:";
    } catch {
      return true;
    }
  });
}

export function invalidLineUserIds(list: string[]): string[] {
  return list.filter((id) => !LINE_USER_ID_RE.test(id));
}
