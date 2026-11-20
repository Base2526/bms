/** A missing build-time WS endpoint must never turn into a relative browser URL. */
export function configuredRealtimeWsUrl(value: string | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const candidate = value.trim();
  try {
    const url = new URL(candidate);
    if ((url.protocol !== "ws:" && url.protocol !== "wss:") || !url.hostname
      || url.username || url.password || url.hash) return null;
    return candidate;
  } catch {
    return null;
  }
}
