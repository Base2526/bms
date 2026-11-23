// Links whose target was typed by a shop owner, staff member or customer. React 18 only warns
// about `javascript:` hrefs, so every such link goes through one of these guards before render.

/** A shop's own website on a public page: http(s) only; a bare host gets https://. */
export function safePublicWebsiteUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** A stored URL (e.g. a payment slip): a same-origin path or an absolute http(s) URL, nothing else. */
export function safeStoredLinkUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /[\u0000-\u001f\u007f\\]/.test(trimmed)) return null;
  if (trimmed.startsWith("/")) return trimmed.startsWith("//") ? null : trimmed;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
