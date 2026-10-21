import { createHash } from "node:crypto";

// Server-only: the public LINE link/ID module must remain usable in client bundles.
const PROVIDER_KEYS = new Set([
  "botDisplayName", "botBasicId", "botPictureUrl", "botChatMode", "botInfoSyncedAt",
  "botInfoErrorAt", "botInfoError", "botIdentityTokenHash",
]);
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Binding, not a bearer credential. Never accept this value from channel settings. */
export function lineBotTokenHash(token: string): string {
  return createHash("sha256").update(`bms/line-bot-identity/v1\0${token}`).digest("hex");
}

export function hasVerifiedLineBotIdentity(extra: unknown, token: string | null): boolean {
  if (!token) return false;
  const data = record(extra);
  const at = typeof data.botInfoSyncedAt === "string" ? Date.parse(data.botInfoSyncedAt) : NaN;
  return typeof data.botBasicId === "string" && /^@[a-z0-9._-]{1,40}$/i.test(data.botBasicId) &&
    Number.isFinite(at) && at > 0 && at <= Date.now() && data.botIdentityTokenHash === lineBotTokenHash(token);
}

/** Settings may replace custom extra fields, never provider-owned identity or diagnostics. */
export function lineChannelExtra(previous: unknown, supplied: unknown, tokenChanged: boolean): Record<string, unknown> {
  const result = Object.fromEntries(Object.entries(record(supplied ?? previous)).filter(([key]) => !PROVIDER_KEYS.has(key)));
  if (!tokenChanged) {
    for (const [key, value] of Object.entries(record(previous))) if (PROVIDER_KEYS.has(key)) result[key] = value;
  }
  return result;
}
