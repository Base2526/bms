/** Bound and redact diagnostic text before it reaches stdout, Postgres or alerts. */
const SENSITIVE_KEY = /(authorization|cookie|token|secret|password|passcode|pin|api[_-]?key|card|account|raw|payload|request|response|body|note|address|phone|email|prompt|session|(?:^|[_-])ip(?:$|[_-])|ip[_-]?address|customer.*name|recipient.*name|full.?name|first.?name|last.?name)/i;
const CREDENTIAL = /["']?\b(?:authorization|password|passcode|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|device[_-]?token|cookie|pin)["']?\s*[:=]\s*(?:["'][^"']*["']|[^\s"'&,;}]+)/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)?\b/g;
const API_TOKEN = /\b(?:sk-|xox[baprs]-|gh[pousr]_|pos_)[A-Za-z0-9_-]{8,}\b/gi;
const ENCRYPTED = /\benc:[A-Za-z0-9+/=:]{8,}/gi;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const THAI_PHONE = /(?:\+66[689]\d{8}|\b0[689]\d{8}\b)/g;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const LONG_NUMBER = /\b\d{10,19}\b/g;
const LONG_HEX = /\b[0-9a-f]{32,}\b/gi;
const LONG_TOKEN = /\b[A-Za-z0-9_-]{40,}\b/g;

export function sanitizeLogText(value: unknown, max = 2_000): string {
  return String(value ?? "")
    .replace(CREDENTIAL, "[REDACTED]")
    .replace(BEARER, "[REDACTED]")
    .replace(JWT, "[REDACTED]")
    .replace(API_TOKEN, "[REDACTED]")
    .replace(ENCRYPTED, "[REDACTED]")
    .replace(EMAIL, "[EMAIL]")
    .replace(THAI_PHONE, "[PHONE]")
    .replace(IPV4, "[IP]")
    .replace(LONG_NUMBER, "[NUMBER]")
    .replace(LONG_HEX, "[HEX]")
    .replace(LONG_TOKEN, "[REDACTED]")
    .slice(0, max);
}

export function sanitizeLogValue(value: unknown, depth = 0, parentKey = ""): unknown {
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    if (/^(?:userId|user_id|actorId)$/i.test(parentKey) && /^(?:\d{1,10}|[0-9a-f-]{36})$/i.test(value)) return value;
    return sanitizeLogText(value, /stack/i.test(parentKey) ? 12_000 : 2_000);
  }
  if (depth >= 5) return "[TRUNCATED]";
  if (value instanceof Error) return {
    name: sanitizeLogText(value.name, 120),
    message: sanitizeLogText(value.message),
    stack: sanitizeLogText(value.stack, 12_000),
  };
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeLogValue(item, depth + 1, parentKey));
  if (typeof value !== "object") return sanitizeLogText(value, 500);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const safeKey = sanitizeLogText(key, 120);
    if (safeKey === "__proto__" || safeKey === "constructor" || safeKey === "prototype") continue;
    out[safeKey] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeLogValue(item, depth + 1, key);
  }
  return out;
}
