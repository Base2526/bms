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

/** Keep the register geometry deterministic while leaving OS-level magnifiers alone. */
export function installFixedZoomPolicy(webContents) {
  const resetZoom = () => {
    if (typeof webContents.isDestroyed === "function" && webContents.isDestroyed()) return;
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

export function desktopMenuTemplate(platform, devToolsEnabled = false) {
  const viewSubmenu = [
    { role: "reload" },
    { role: "forceReload" },
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
