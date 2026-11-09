export const POS_ASSET_RECOVERY_PARAM = "_bms_pos_asset_reload";
export const POS_ASSET_RECOVERY_WINDOW_MS = 60_000;

export function isPosAssetLoadError(error: Pick<Error, "name" | "message">): boolean {
  return error.name === "ChunkLoadError"
    || /(?:Loading (?:CSS )?chunk|ChunkLoadError|Failed to fetch dynamically imported module)/i.test(error.message);
}

export function posAssetRecoveryWasAttempted(href: string, now: number): boolean {
  try {
    const attemptedAt = Number(new URL(href).searchParams.get(POS_ASSET_RECOVERY_PARAM));
    return Number.isFinite(attemptedAt)
      && attemptedAt > 0
      && now - attemptedAt < POS_ASSET_RECOVERY_WINDOW_MS;
  } catch {
    // A malformed location must never turn an asset failure into an automatic reload loop.
    return true;
  }
}

export function posAssetRecoveryUrl(href: string, now: number): string {
  const url = new URL(href);
  url.searchParams.set(POS_ASSET_RECOVERY_PARAM, String(now));
  return url.toString();
}
