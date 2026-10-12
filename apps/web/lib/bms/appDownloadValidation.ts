export class InvalidAppDownloadSettings extends Error {}

function downloadUrl(value: unknown): string {
  if (typeof value !== "string") throw new InvalidAppDownloadSettings("INVALID_DOWNLOAD_URL");
  const text = value.trim();
  if (!text) return "";
  if (text.length > 2048 || !/^https:\/\/[^/\\]/i.test(text) || /[\u0000-\u0020\u007f\\]/.test(text)) {
    throw new InvalidAppDownloadSettings("INVALID_DOWNLOAD_URL");
  }
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password || url.href.length > 2048) throw new Error();
    return url.href;
  } catch {
    throw new InvalidAppDownloadSettings("INVALID_DOWNLOAD_URL");
  }
}

export function normalizeAppDownloadSettings(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InvalidAppDownloadSettings("INVALID_DOWNLOAD_URL");
  }
  const values = input as Record<string, unknown>;
  return { androidUrl: downloadUrl(values.androidUrl), iosUrl: downloadUrl(values.iosUrl) };
}
