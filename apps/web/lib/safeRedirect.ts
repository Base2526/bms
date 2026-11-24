// A destination taken from the URL (e.g. /admin/login?next=...) must stay on this origin.
// Only a root-relative path is accepted; absolute URLs, protocol-relative `//host`, backslash
// tricks (`/\host`), control characters that URL parsers strip, and `javascript:`/`data:`
// schemes all fall back to a fixed in-app page.

const PARSE_BASE = "https://bms.invalid";

export function safeInternalRedirectPath(value: string | null | undefined, fallback = "/admin"): string {
  if (typeof value !== "string" || !value) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const url = new URL(value, PARSE_BASE);
    if (url.origin !== PARSE_BASE) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
