export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX_BYTES = 72;
export const EMAIL_MAX = 254;

const USERNAME_PATTERN = /^[a-z0-9._-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "api",
  "moderator",
  "root",
  "staff",
  "support",
  "system",
]);

function canonicalText(value: unknown): string {
  return String(value ?? "").trim().normalize("NFKC").toLowerCase();
}

export function normalizeUsername(value: unknown): string {
  return canonicalText(value);
}

export function normalizeEmail(value: unknown): string {
  return canonicalText(value);
}

export function validateUsername(value: unknown):
  | { ok: true; value: string }
  | { ok: false; code: "REQUIRED" | "LENGTH" | "FORMAT" | "EDGE" | "CONSECUTIVE" | "RESERVED" } {
  const username = normalizeUsername(value);
  if (!username) return { ok: false, code: "REQUIRED" };
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return { ok: false, code: "LENGTH" };
  }
  if (!USERNAME_PATTERN.test(username)) return { ok: false, code: "FORMAT" };
  if (/^[._-]|[._-]$/.test(username)) return { ok: false, code: "EDGE" };
  if (/[._-]{2,}/.test(username)) return { ok: false, code: "CONSECUTIVE" };
  if (RESERVED_USERNAMES.has(username)) return { ok: false, code: "RESERVED" };
  return { ok: true, value: username };
}

export function validateEmail(value: unknown):
  | { ok: true; value: string }
  | { ok: false; code: "REQUIRED" | "LENGTH" | "FORMAT" } {
  const email = normalizeEmail(value);
  if (!email) return { ok: false, code: "REQUIRED" };
  if (email.length > EMAIL_MAX) return { ok: false, code: "LENGTH" };
  if (!EMAIL_PATTERN.test(email)) return { ok: false, code: "FORMAT" };
  return { ok: true, value: email };
}

export function validateNewPassword(value: unknown):
  | { ok: true; value: string }
  | { ok: false; code: "REQUIRED" | "TOO_SHORT" | "TOO_LONG" } {
  const password = typeof value === "string" ? value : "";
  if (!password) return { ok: false, code: "REQUIRED" };
  if (password.length < PASSWORD_MIN) return { ok: false, code: "TOO_SHORT" };
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return { ok: false, code: "TOO_LONG" };
  }
  return { ok: true, value: password };
}
