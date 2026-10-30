import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// "Open BMS POS when the computer starts" — a per-user OS setting. It is ON by default: a POS
// terminal that does not come back after a power cut leaves the counter unable to sell until
// someone finds the icon. The default is applied once, on the first packaged launch; after that
// the operator's own choice (stored in `preferencePath`) always wins, so unticking stays unticked.
//
// macOS and Windows use Electron's own login-item API. Linux has no such API in Electron, so the
// XDG autostart entry (~/.config/autostart) is written directly — GNOME, KDE, XFCE and Cinnamon
// all read it.

const LINUX_AUTOSTART_FILE = "bms-pos.desktop";
// Windows Run-key value name. Must stay equal to the AppUserModelId set in main.mjs and to the
// value installer/uninstall-login-item.nsh deletes on uninstall.
export const WINDOWS_LOGIN_ITEM_NAME = "com.bms.pos.desktop";

/** Quote an Exec= argument per the freedesktop Desktop Entry spec. */
export function desktopEntryExecArg(value) {
  const text = String(value);
  if (/[\0\r\n]/.test(text)) throw new Error("The launch executable path is not desktop-entry safe");
  // `%` introduces a field code even inside quotes. `%%` is the Desktop Entry literal form.
  return `"${text.replace(/%/g, "%%").replace(/(["`$\\])/g, "\\$1")}"`;
}

export function linuxAutostartEntry(executablePath) {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=BMS POS",
    `Exec=${desktopEntryExecArg(executablePath)}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

/** The executable an existing autostart entry starts, or null when it cannot be read. */
export function linuxAutostartExec(contents) {
  const line = String(contents).split(/\r?\n/).find((entry) => entry.startsWith("Exec="));
  if (!line) return null;
  const raw = line.slice("Exec=".length).trim();
  if (!raw.startsWith('"')) return raw.split(/\s+/)[0] || null;
  const match = /^"((?:[^"\\]|\\.)*)"/.exec(raw);
  return match ? match[1].replace(/%%/g, "%").replace(/\\(.)/g, "$1") : null;
}

/** GNOME/KDE "Startup Applications" switches an entry off in place instead of deleting it. */
export function linuxAutostartActive(contents) {
  const text = String(contents);
  if (!text.includes("[Desktop Entry]")) return false;
  if (!/^Type\s*=\s*Application\s*$/mi.test(text)) return false;
  if (linuxAutostartExec(text) === null) return false;
  if (/^Hidden\s*=\s*true\s*$/mi.test(text)) return false;
  if (/^X-GNOME-Autostart-enabled\s*=\s*false\s*$/mi.test(text)) return false;
  return true;
}

export function linuxAutostartPath(env = process.env) {
  const configHome = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME)
    ? env.XDG_CONFIG_HOME
    : path.join(homedir(), ".config");
  return path.join(configHome, "autostart", LINUX_AUTOSTART_FILE);
}

/**
 * The path the OS should start. An AppImage runs from a temporary mount that disappears after
 * exit, so the autostart entry must point at the .AppImage file itself ($APPIMAGE).
 */
export function launchExecutablePath({ platform, execPath, env = process.env }) {
  if (platform === "linux" && env.APPIMAGE) return env.APPIMAGE;
  return execPath;
}

/**
 * Unpackaged (`npm run dev`) builds start the shared Electron binary, not this app — registering
 * that at login would open an empty Electron window on every boot, so the option is disabled.
 */
export function launchAtLoginSupported({ platform, isPackaged }) {
  return isPackaged === true && ["darwin", "win32", "linux"].includes(platform);
}

export const LAUNCH_AT_LOGIN_DEFAULT = true;

export function createLaunchAtLogin({
  app,
  preferencePath = null,
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
  fs = { mkdir, readFile, rename, rm, writeFile },
}) {
  // A function lets main.mjs defer app.getPath("userData") until it is actually needed.
  const preferenceFile = () => (typeof preferencePath === "function" ? preferencePath() : preferencePath);
  const supported = () => launchAtLoginSupported({ platform, isPackaged: app.isPackaged });
  const executable = () => launchExecutablePath({ platform, execPath, env });
  const windowsItem = () => ({ name: WINDOWS_LOGIN_ITEM_NAME, path: execPath });

  /**
   * Why turning it on cannot work right now, or null. A macOS app still running from the
   * mounted DMG (or a translocated copy) would register a path that is gone after the next
   * reboot, so it must be moved to Applications first.
   */
  function blockedReason() {
    if (!supported()) return "unsupported";
    if (platform === "darwin" && typeof app.isInApplicationsFolder === "function" && !app.isInApplicationsFolder()) {
      return "not-in-applications";
    }
    return null;
  }

  async function readLinuxEntry() {
    try {
      return await fs.readFile(linuxAutostartPath(env), "utf8");
    } catch {
      return null;
    }
  }

  async function writeAtomic(file, contents, mode) {
    const temporary = `${file}.tmp`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(temporary, contents, { mode });
    await fs.rename(temporary, file);
  }

  function loginItemSettings() {
    return platform === "win32" ? app.getLoginItemSettings(windowsItem()) : app.getLoginItemSettings();
  }

  async function isEnabled() {
    if (!supported()) return false;
    if (platform === "linux") {
      const entry = await readLinuxEntry();
      return entry != null && linuxAutostartActive(entry);
    }
    const settings = loginItemSettings();
    if (settings.openAtLogin !== true) return false;
    // Windows: Task Manager > Startup can disable the entry while the Run value stays.
    if (platform === "win32" && settings.executableWillLaunchAtLogin === false) return false;
    // macOS 13+: registered but waiting for the user to allow it in Login Items.
    if (platform === "darwin" && settings.status === "requires-approval") return false;
    return true;
  }

  async function setEnabled(enabled) {
    if (!supported()) return false;
    if (enabled === true && blockedReason()) return isEnabled();
    if (platform === "linux") {
      const file = linuxAutostartPath(env);
      if (enabled) {
        await writeAtomic(file, linuxAutostartEntry(executable()), 0o644);
      } else {
        await fs.rm(file, { force: true });
      }
    } else if (platform === "win32") {
      // `enabled` also clears a Task Manager "Disabled" mark when the operator ticks the box.
      app.setLoginItemSettings({ ...windowsItem(), openAtLogin: enabled === true, enabled: enabled === true });
    } else {
      app.setLoginItemSettings({ openAtLogin: enabled === true });
    }
    // Remember the operator's choice so the first-run default is never re-applied over it.
    await savePreference(enabled === true);
    // Report what the OS actually kept, not what was asked for: macOS can refuse or hold the
    // item for approval, and the menu checkbox must never claim a state that is not real.
    return isEnabled();
  }

  async function savePreference(openAtLogin) {
    const file = preferenceFile();
    if (!file) return;
    await writeAtomic(file, `${JSON.stringify({ version: 1, openAtLogin })}\n`, 0o600);
  }

  /** The saved choice: true / false, or null when the operator has never been asked. */
  async function readPreference() {
    const file = preferenceFile();
    if (!file) return null;
    try {
      const saved = JSON.parse(await fs.readFile(file, "utf8"));
      return typeof saved?.openAtLogin === "boolean" ? saved.openAtLogin : null;
    } catch {
      return null;
    }
  }

  /**
   * Keep an existing registration pointing at this copy of the app. A reinstall into another
   * folder (Windows), or a newer AppImage saved elsewhere (Linux), would otherwise keep starting
   * the old path. Entries the operator switched off in the OS are left alone, and macOS is
   * skipped because its login items follow the bundle, not a path.
   */
  async function refreshRegisteredPath() {
    if (platform === "linux") {
      const entry = await readLinuxEntry();
      if (entry == null || !linuxAutostartActive(entry)) return;
      if (linuxAutostartExec(entry) === executable()) return;
      await writeAtomic(linuxAutostartPath(env), linuxAutostartEntry(executable()), 0o644);
      return;
    }
    if (platform === "win32") {
      const settings = loginItemSettings();
      const items = Array.isArray(settings.launchItems) ? settings.launchItems : [];
      const namedItems = items.filter((item) => item?.name === WINDOWS_LOGIN_ITEM_NAME);
      // setLoginItemSettings writes HKCU. Never rewrite or duplicate an administrator-managed
      // machine entry; only maintain the per-user value this app owns. Older Electron versions
      // did not expose `scope`, so keep accepting an unscoped matching item as the user value.
      const ours = namedItems.find((item) => item.scope === "user")
        ?? namedItems.find((item) => item.scope == null);
      if (!ours && namedItems.some((item) => item.scope === "machine")) return;
      // No value at all = the uninstaller removed it; the saved choice says it should exist.
      if (ours && ours.enabled === false) return;
      if (ours && String(ours.path).toLowerCase() === execPath.toLowerCase()) return;
      app.setLoginItemSettings({ ...windowsItem(), openAtLogin: true, enabled: true });
    }
  }

  /** Apply the default once per user profile, then report the real OS state. */
  async function initialize() {
    if (!supported()) return false;
    const saved = await readPreference();
    // setEnabled leaves the choice unsaved when it is blocked (macOS app still on the DMG), so
    // the default is applied again on a later launch from Applications.
    if (saved === null) return setEnabled(LAUNCH_AT_LOGIN_DEFAULT);
    if (saved === true) await refreshRegisteredPath();
    return isEnabled();
  }

  return { supported, blockedReason, isEnabled, setEnabled, initialize };
}
