const ZOOM_KEYS = new Set(["+", "=", "-", "_", "0"]);
const ZOOM_CODES = new Set([
  "Equal",
  "Minus",
  "Digit0",
  "NumpadAdd",
  "NumpadSubtract",
  "Numpad0",
]);

export function isDesktopZoomShortcut(input) {
  if (!input || (!input.control && !input.meta) || input.alt) return false;
  return ZOOM_KEYS.has(input.key) || ZOOM_CODES.has(input.code);
}

/** Disable Chromium's native trackpad/touch pinch path before Electron becomes ready. */
export function installGlobalZoomPolicy(app) {
  app.commandLine.appendSwitch("disable-pinch");
}

/** Keep the register geometry deterministic while leaving OS-level magnifiers alone. */
export function installFixedZoomPolicy(webContents) {
  const resetZoom = () => {
    if (typeof webContents.isDestroyed === "function" && webContents.isDestroyed()) return;
    webContents.setZoomLevel?.(0);
    webContents.setZoomFactor(1);
  };

  resetZoom();
  Promise.resolve(webContents.setVisualZoomLevelLimits(1, 1)).catch(() => void 0);
  webContents.on("did-finish-load", resetZoom);
  webContents.on("before-input-event", (event, input) => {
    if (!isDesktopZoomShortcut(input)) return;
    event.preventDefault();
    resetZoom();
  });
  webContents.on("zoom-changed", (event) => {
    event.preventDefault();
    resetZoom();
  });
}

export function desktopMenuTemplate(platform, devToolsEnabled = false, actions = {}) {
  const viewSubmenu = [
    {
      label: "รีเฟรชข้อมูลหน้าปัจจุบัน",
      accelerator: "CmdOrCtrl+R",
      click: typeof actions.refreshData === "function" ? actions.refreshData : () => {},
    },
    {
      label: "โหลดแอปใหม่ทั้งหมด (เมื่อหน้าค้าง)",
      accelerator: "CmdOrCtrl+Shift+R",
      click: typeof actions.reloadApplication === "function" ? actions.reloadApplication : () => {},
    },
    ...(devToolsEnabled
      ? [{ type: "separator" }, { role: "toggleDevTools" }]
      : []),
    { type: "separator" },
    { role: "togglefullscreen" },
  ];

  return [
    ...(platform === "darwin" ? [{ role: "appMenu" }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { label: "View", submenu: viewSubmenu },
    { role: "windowMenu" },
  ];
}
