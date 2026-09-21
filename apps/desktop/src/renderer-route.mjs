export const MOBILE_POS_PATH = "/pos/app";
export const LEGACY_POS_PATH = "/pos";
export const POS_PROBE_TIMEOUT_MS = 6_000;
export const POS_NAVIGATION_TIMEOUT_MS = 30_000;

/** Old BMS servers do not expose the new renderer yet; keep the installed app usable during rollout. */
export function posEntryPathForStatus(status) {
  return status === 404 ? LEGACY_POS_PATH : MOBILE_POS_PATH;
}

/**
 * The compatibility probe must never hold the native window on an empty document. A failed or
 * slow probe is not evidence that the new renderer is absent, so retain the strict 404-only
 * fallback and let Chromium perform the real navigation.
 */
export async function resolvePosEntryPath(probe, timeoutMs = POS_PROBE_TIMEOUT_MS) {
  const controller = new AbortController();
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("POS route probe timed out"));
      }, timeoutMs);
    });
    const status = await Promise.race([probe(controller.signal), timeout]);
    return posEntryPathForStatus(status);
  } catch {
    return MOBILE_POS_PATH;
  } finally {
    clearTimeout(timer);
  }
}
