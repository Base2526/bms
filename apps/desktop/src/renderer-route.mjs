export const MOBILE_POS_PATH = "/pos/app";
export const LEGACY_POS_PATH = "/pos";

/** Old BMS servers do not expose the new renderer yet; keep the installed app usable during rollout. */
export function posEntryPathForStatus(status) {
  return status === 404 ? LEGACY_POS_PATH : MOBILE_POS_PATH;
}
