export function isSessionVersionCurrent(
  tokenVersion: number | null | undefined,
  currentVersion: number | string | null | undefined
): boolean {
  return Number(tokenVersion ?? 0) === Number(currentVersion ?? 0);
}
