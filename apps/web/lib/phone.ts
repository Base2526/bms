// ===== helpers/phone.ts =====
export function normalizePhone(raw: string): string {
  if (!raw) return "";
  const s = String(raw).trim();
  if (!s) return "";

  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return "";

  // Canonical: match normalizeTel() used in GraphQL resolvers
  // Thai mobile: 0xxxxxxxxx (10 digits) -> 66xxxxxxxxx
  if (digits.startsWith("0") && digits.length === 10) return "66" + digits.slice(1);

  return digits;
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
