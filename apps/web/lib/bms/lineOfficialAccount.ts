/**
 * BMS's own LINE Official Account — the channel prospects and shop owners use
 * to reach the BMS team. This is NOT a shop's LINE OA: shops connect their own
 * accounts through `bms_tenant_channels`, and their customers never see this one.
 *
 * The ID is public and identical in every environment, so it lives here rather
 * than in env: `NEXT_PUBLIC_*` values are baked into the production image at
 * build time, and a constant cannot drift between a build and its .env file.
 */
export const BMS_LINE_OA_ID = "@168tnlzi";

const LINE_ID_PATTERN = /^@[a-z0-9._-]{1,40}$/i;

/**
 * The add-friend link LINE documents (`https://line.me/R/ti/p/%40{id}`).
 * On a phone it opens the LINE app straight onto the account's add-friend
 * screen; on a desktop it shows LINE's own page with a QR code.
 */
export function lineAddFriendUrl(lineId: string): string {
  const id = lineId.trim();
  if (!LINE_ID_PATTERN.test(id)) throw new Error(`Invalid LINE Official Account ID: ${lineId}`);
  return `https://line.me/R/ti/p/${encodeURIComponent(id)}`;
}

export const BMS_LINE_OA_URL = lineAddFriendUrl(BMS_LINE_OA_ID);

/**
 * Identify the BMS prospect channel only from LINE's verified bot identity cached by
 * `syncLineBotInfo()`. Admin-entered labels or tenant ids must never select this mode.
 */
export function isBmsLineOfficialAccount(extra: unknown): boolean {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return false;
  const providerIdentity = extra as { botBasicId?: unknown; botInfoSyncedAt?: unknown };
  return typeof providerIdentity.botInfoSyncedAt === "string" &&
    typeof providerIdentity.botBasicId === "string" &&
    providerIdentity.botBasicId.trim().toLowerCase() === BMS_LINE_OA_ID.toLowerCase();
}
