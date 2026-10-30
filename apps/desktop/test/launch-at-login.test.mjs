import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createLaunchAtLogin,
  desktopEntryExecArg,
  launchAtLoginSupported,
  launchExecutablePath,
  linuxAutostartActive,
  linuxAutostartEntry,
  linuxAutostartExec,
  linuxAutostartPath,
  WINDOWS_LOGIN_ITEM_NAME,
} from "../src/launch-at-login.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
import { desktopMenuTemplate } from "../src/zoom-policy.mjs";

function memoryFs() {
  const files = new Map();
  return {
    files,
    mkdir: async () => {},
    readFile: async (file) => {
      if (!files.has(file)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return files.get(file);
    },
    rename: async (source, destination) => {
      if (!files.has(source)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      files.set(destination, files.get(source));
      files.delete(source);
    },
    writeFile: async (file, data) => { files.set(file, data); },
    rm: async (file) => { files.delete(file); },
  };
}

function fakeApp({ isPackaged = true, keep = true, inApplications = true } = {}) {
  // Models Windows' Run value + Task Manager flag, and macOS' approval status.
  const state = { openAtLogin: false, path: null, taskManagerEnabled: true, status: undefined, calls: [] };
  return {
    state,
    isPackaged,
    isInApplicationsFolder: () => inApplications,
    getLoginItemSettings: (options) => {
      const matches = state.openAtLogin && (!options?.path || options.path === state.path);
      return {
        openAtLogin: matches,
        executableWillLaunchAtLogin: matches && state.taskManagerEnabled,
        status: state.status,
        launchItems: state.openAtLogin
          ? [{ name: WINDOWS_LOGIN_ITEM_NAME, path: state.path, enabled: state.taskManagerEnabled, scope: "user" }]
          : [],
      };
    },
    setLoginItemSettings: (settings) => {
      state.calls.push(settings);
      if (!keep) return;
      state.openAtLogin = settings.openAtLogin;
      state.path = settings.path ?? "/Applications/BMS POS.app";
      if (settings.enabled !== undefined) state.taskManagerEnabled = settings.enabled;
    },
  };
}

test("launch at login is unsupported for unpackaged dev builds", async () => {
  assert.equal(launchAtLoginSupported({ platform: "darwin", isPackaged: false }), false);
  assert.equal(launchAtLoginSupported({ platform: "freebsd", isPackaged: true }), false);
  const app = fakeApp({ isPackaged: false });
  const login = createLaunchAtLogin({ app, platform: "win32" });
  assert.equal(await login.isEnabled(), false);
  assert.equal(await login.setEnabled(true), false);
  assert.equal(app.state.calls.length, 0, "a dev build must never register the bare Electron binary");
});

test("macOS and Windows go through Electron's login-item API and report the kept state", async () => {
  for (const platform of ["darwin", "win32"]) {
    const app = fakeApp();
    const login = createLaunchAtLogin({ app, platform });
    assert.equal(await login.isEnabled(), false);
    assert.equal(await login.setEnabled(true), true);
    assert.equal(app.state.calls.at(-1).openAtLogin, true);
    if (platform === "win32") assert.equal(app.state.calls.at(-1).name, WINDOWS_LOGIN_ITEM_NAME);
    assert.equal(await login.setEnabled(false), false);
  }
});

test("a login item the OS refuses is reported as off, not as what was asked", async () => {
  const app = fakeApp({ keep: false });
  const login = createLaunchAtLogin({ app, platform: "darwin" });
  assert.equal(await login.setEnabled(true), false);
});

test("Linux writes and removes an XDG autostart entry pointing at the AppImage file", async () => {
  const fs = memoryFs();
  const env = { XDG_CONFIG_HOME: "/home/cashier/.config", APPIMAGE: "/home/cashier/BMS POS.AppImage" };
  const login = createLaunchAtLogin({ app: fakeApp(), platform: "linux", env, fs });
  const file = path.join("/home/cashier/.config", "autostart", "bms-pos.desktop");

  assert.equal(await login.setEnabled(true), true);
  const entry = fs.files.get(file);
  assert.match(entry, /^\[Desktop Entry\]/);
  assert.match(entry, /^Exec="\/home\/cashier\/BMS POS\.AppImage"$/m);
  assert.equal(await login.setEnabled(false), false);
  assert.equal(fs.files.has(file), false);
});

test("autostart helpers quote Exec values and ignore relative XDG_CONFIG_HOME", () => {
  assert.equal(desktopEntryExecArg('/opt/a "b"/$x'), '"/opt/a \\"b\\"/\\$x"');
  assert.equal(desktopEntryExecArg("/opt/100%/BMS"), '"/opt/100%%/BMS"');
  assert.throws(() => desktopEntryExecArg("/opt/BMS\nExec=/bin/sh"), /not desktop-entry safe/);
  assert.match(linuxAutostartEntry("/opt/BMS POS/bms-pos"), /Exec="\/opt\/BMS POS\/bms-pos"/);
  assert.equal(launchExecutablePath({ platform: "linux", execPath: "/x", env: {} }), "/x");
  assert.equal(launchExecutablePath({ platform: "win32", execPath: "C:\\a.exe", env: { APPIMAGE: "/y" } }), "C:\\a.exe");
  assert.ok(linuxAutostartPath({ XDG_CONFIG_HOME: "relative" }).endsWith(path.join(".config", "autostart", "bms-pos.desktop")));
});

test("BMS POS menu shows a launch-at-login checkbox on every platform", () => {
  for (const platform of ["darwin", "win32", "linux"]) {
    let toggled = 0;
    const template = desktopMenuTemplate(platform, false, {
      launchAtLogin: true,
      launchAtLoginSupported: true,
      toggleLaunchAtLogin: () => { toggled += 1; },
    });
    const item = template.find((entry) => entry.label === "BMS POS").submenu
      .find((entry) => entry.label === "เปิดแอปอัตโนมัติเมื่อเปิดเครื่อง");
    assert.equal(item.type, "checkbox");
    assert.equal(item.checked, true);
    assert.equal(item.enabled, true);
    item.click();
    assert.equal(toggled, 1);
  }
  const off = desktopMenuTemplate("win32").find((entry) => entry.label === "BMS POS").submenu
    .find((entry) => entry.type === "checkbox");
  assert.equal(off.checked, false);
  assert.equal(off.enabled, false);
});

test("first packaged launch turns launch-at-login on, then the operator's choice wins", async () => {
  const fs = memoryFs();
  const app = fakeApp();
  const prefs = "/profile/launch-at-login.json";
  const first = createLaunchAtLogin({ app, platform: "win32", preferencePath: prefs, fs });
  assert.equal(await first.initialize(), true, "default must be checked");
  assert.equal(app.state.calls.length, 1);
  assert.equal(app.state.calls[0].openAtLogin, true);

  assert.equal(await first.setEnabled(false), false);
  const restarted = createLaunchAtLogin({ app, platform: "win32", preferencePath: () => prefs, fs });
  assert.equal(await restarted.initialize(), false, "an unticked box must stay unticked after restart");
  assert.equal(app.state.calls.length, 2, "the default is not re-applied once a choice exists");
});

test("the default is not applied to unpackaged dev builds", async () => {
  const app = fakeApp({ isPackaged: false });
  const login = createLaunchAtLogin({ app, platform: "darwin", preferencePath: "/p.json", fs: memoryFs() });
  assert.equal(await login.initialize(), false);
  assert.equal(app.state.calls.length, 0);
});

test("Windows: an entry disabled in Task Manager reads as off and is not forced back on at startup", async () => {
  const fs = memoryFs();
  const app = fakeApp();
  const prefs = "/profile/launch-at-login.json";
  const execPath = "C:\\Users\\pos\\AppData\\Local\\Programs\\bms\\BMS POS.exe";
  const login = createLaunchAtLogin({ app, platform: "win32", preferencePath: prefs, execPath, fs });
  assert.equal(await login.initialize(), true);
  app.state.taskManagerEnabled = false;
  assert.equal(await login.isEnabled(), false);
  const calls = app.state.calls.length;
  assert.equal(await login.initialize(), false);
  assert.equal(app.state.calls.length, calls, "the operator's Task Manager choice is respected");
  assert.equal(await login.setEnabled(true), true, "ticking the box clears the Task Manager mark");

  app.state.taskManagerEnabled = false;
  const reinstalled = createLaunchAtLogin({ app, platform: "win32", preferencePath: prefs, execPath: "D:\\BMS POS.exe", fs });
  await reinstalled.initialize();
  assert.equal(app.state.taskManagerEnabled, false, "a reinstall must not undo a Task Manager disable");
});

test("Windows: a reinstall into another folder, or an uninstall + reinstall, re-points the entry", async () => {
  const fs = memoryFs();
  const app = fakeApp();
  const prefs = "/profile/launch-at-login.json";
  await createLaunchAtLogin({ app, platform: "win32", preferencePath: prefs, execPath: "C:\\old\\BMS POS.exe", fs }).initialize();

  const moved = createLaunchAtLogin({ app, platform: "win32", preferencePath: prefs, execPath: "D:\\new\\BMS POS.exe", fs });
  assert.equal(await moved.initialize(), true);
  assert.equal(app.state.path, "D:\\new\\BMS POS.exe");

  app.state.openAtLogin = false; // the uninstaller deleted the Run value
  assert.equal(await moved.initialize(), true);
});

test("Windows: startup refresh never rewrites or duplicates a machine-managed login item", async () => {
  const fs = memoryFs();
  const prefs = "/profile/launch-at-login.json";
  fs.files.set(prefs, JSON.stringify({ version: 1, openAtLogin: true }));
  const app = fakeApp();
  app.getLoginItemSettings = () => ({
    openAtLogin: false,
    executableWillLaunchAtLogin: false,
    launchItems: [{
      name: WINDOWS_LOGIN_ITEM_NAME,
      path: "C:\\Program Files\\BMS POS\\BMS POS.exe",
      enabled: true,
      scope: "machine",
    }],
  });

  const login = createLaunchAtLogin({
    app,
    platform: "win32",
    preferencePath: prefs,
    execPath: "C:\\Users\\cashier\\BMS POS.exe",
    fs,
  });
  assert.equal(await login.initialize(), false);
  assert.equal(app.state.calls.length, 0);
});

test("macOS: the default waits until the app runs from Applications", async () => {
  const fs = memoryFs();
  const prefs = "/profile/launch-at-login.json";
  const onDmg = fakeApp({ inApplications: false });
  const login = createLaunchAtLogin({ app: onDmg, platform: "darwin", preferencePath: prefs, fs });
  assert.equal(login.blockedReason(), "not-in-applications");
  assert.equal(await login.initialize(), false);
  assert.equal(await login.setEnabled(true), false);
  assert.equal(onDmg.state.calls.length, 0);
  assert.equal(fs.files.has(prefs), false, "no choice is recorded, so the default still applies later");

  const installed = fakeApp();
  assert.equal(await createLaunchAtLogin({ app: installed, platform: "darwin", preferencePath: prefs, fs }).initialize(), true);
});

test("macOS: a login item waiting for approval is reported as off", async () => {
  const app = fakeApp();
  const login = createLaunchAtLogin({ app, platform: "darwin" });
  await login.setEnabled(true);
  app.state.status = "requires-approval";
  assert.equal(await login.isEnabled(), false);
});

test("Linux: an entry switched off in Startup Applications stays off; a moved AppImage is re-pointed", async () => {
  const fs = memoryFs();
  const prefs = "/profile/launch-at-login.json";
  const file = path.join("/cfg", "autostart", "bms-pos.desktop");
  const make = (appImage) => createLaunchAtLogin({
    app: fakeApp(), platform: "linux", preferencePath: prefs, fs,
    env: { XDG_CONFIG_HOME: "/cfg", APPIMAGE: appImage },
  });
  assert.equal(await make("/home/a/BMS-1.AppImage").initialize(), true);

  assert.equal(await make("/home/a/Downloads/BMS-2.AppImage").initialize(), true);
  assert.equal(linuxAutostartExec(fs.files.get(file)), "/home/a/Downloads/BMS-2.AppImage");

  fs.files.set(file, fs.files.get(file).replace("X-GNOME-Autostart-enabled=true", "X-GNOME-Autostart-enabled=false"));
  const before = fs.files.get(file);
  assert.equal(await make("/home/a/BMS-3.AppImage").initialize(), false);
  assert.equal(fs.files.get(file), before, "a user-disabled entry is not rewritten");
});

test("autostart entry parsing", () => {
  assert.equal(linuxAutostartExec(linuxAutostartEntry('/opt/a "b"/$x')), '/opt/a "b"/$x');
  assert.equal(linuxAutostartExec(linuxAutostartEntry("/opt/100%/BMS")), "/opt/100%/BMS");
  assert.equal(linuxAutostartExec("[Desktop Entry]\nExec=/usr/bin/bms --flag\n"), "/usr/bin/bms");
  assert.equal(linuxAutostartActive("[Desktop Entry]\nHidden=true\n"), false);
  assert.equal(linuxAutostartActive("[Desktop Entry]\nType=Application\n"), false);
  assert.equal(linuxAutostartActive("[Desktop Entry]\nType=Link\nExec=/usr/bin/bms\n"), false);
  assert.equal(linuxAutostartActive("garbage"), false);
  assert.equal(linuxAutostartActive(linuxAutostartEntry("/x")), true);
});

test("the Windows value name matches the AppUserModelId and the uninstaller script", () => {
  const main = readFileSync(path.join(root, "src/main.mjs"), "utf8");
  assert.match(main, new RegExp(`setAppUserModelId\\("${WINDOWS_LOGIN_ITEM_NAME.replace(/\./g, "\\.")}"\\)`));
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const include = pkg.build.nsis.include;
  assert.ok(include && existsSync(path.join(root, include)), "NSIS include must exist");
  assert.doesNotMatch(include, /^build\//, "build/ is gitignored at the repo root");
  const nsh = readFileSync(path.join(root, include), "utf8");
  assert.match(nsh, /!macro customUnInstall/);
  assert.match(nsh, /\$\{ifNot\} \$\{isUpdated\}/, "an update must not delete the operator's choice");
  assert.equal((nsh.match(new RegExp(`"${WINDOWS_LOGIN_ITEM_NAME.replace(/\./g, "\\.")}"`, "g")) ?? []).length, 2);
});
