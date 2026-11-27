/** Registration is per OS user; a real reboot/login test remains a pilot gate. */
export function configureKioskAutostart(electronApp, packaged, platform) {
  if (!packaged || platform !== "win32") return { configured: false, reason: "UNPACKAGED_OR_NON_WINDOWS" };
  try {
    electronApp.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
    return { configured: Boolean(electronApp.getLoginItemSettings().openAtLogin), reason: null };
  } catch { return { configured: false, reason: "OS_REGISTRATION_FAILED" }; }
}
