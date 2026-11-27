export const CLOUD_ORIGIN = "https://bms.jachoei.com";
const PUBLIC_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const DEVICE_TOKEN = /^bmsk_[A-Za-z0-9_-]{43}$/;

export function parseKioskUrl(value, allowedOrigins = [CLOUD_ORIGIN]) {
  if (typeof value !== "string" || value.length > 2048 || value !== value.trim()) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" && !(url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname) && allowedOrigins.includes(url.origin))) return null;
  if (!allowedOrigins.includes(url.origin) || url.username || url.password || url.search || url.hash) return null;
  const match = /^\/kiosk\/([A-Za-z0-9_-]{43})$/.exec(url.pathname);
  if (!match || !PUBLIC_TOKEN.test(match[1])) return null;
  return { url: url.href, origin: url.origin, publicToken: match[1] };
}

export function validDeviceCredential(value) {
  return typeof value === "string" && DEVICE_TOKEN.test(value);
}

export function maskedKioskUrl(value) {
  try { return `${new URL(value).origin}/kiosk/••••`; } catch { return "••••"; }
}
