import desktopLocale from '../renderer/locale.cjs';
const { posText } = desktopLocale;
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
  const openAdmin = {
    label: posText("เปิดระบบหลังบ้าน"),
    accelerator: "CmdOrCtrl+Shift+A",
    enabled: actions.adminAvailable === true,
    click: typeof actions.openAdmin === "function" ? actions.openAdmin : () => {},
  };
  const launchAtLogin = {
    label: posText("เปิดแอปอัตโนมัติเมื่อเปิดเครื่อง"),
    type: "checkbox",
    checked: actions.launchAtLogin === true,
    enabled: actions.launchAtLoginSupported === true,
    click: typeof actions.toggleLaunchAtLogin === "function" ? actions.toggleLaunchAtLogin : () => {},
  };
  const languageMenu = {
    label: 'Language / ภาษา',
    submenu: ['th', 'en'].map((value) => ({
      label: value === 'th' ? 'ไทย' : 'English', type: 'radio',
      checked: (actions.language ?? 'th') === value,
      click: () => actions.setLanguage?.(value),
    })),
  };
  const appSubmenu = platform === "darwin"
    ? [
      { role: "about" },
      { type: "separator" },
      openAdmin,
      launchAtLogin,
      languageMenu,
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ]
    : [openAdmin, launchAtLogin, languageMenu, { type: "separator" }, { role: "quit" }];
  const viewSubmenu = [
    {
      label: posText("รีเฟรชข้อมูลหน้าปัจจุบัน"),
      accelerator: "CmdOrCtrl+R",
      click: typeof actions.refreshData === "function" ? actions.refreshData : () => {},
    },
    {
      label: posText("โหลดแอปใหม่ทั้งหมด (เมื่อหน้าค้าง)"),
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
    { label: "BMS POS", submenu: appSubmenu },
    { role: "fileMenu" },
    { role: "editMenu" },
    { id: "view", label: posText("มุมมอง"), submenu: viewSubmenu },
    { role: "windowMenu" },
  ];
}

/** Localize Electron-generated submenus while retaining native roles and shortcuts. */
export function localizeNativeMenu(menu) {
  const labels = {
    about: posText("เกี่ยวกับ BMS POS"),
    services: posText("บริการ"),
    hide: posText("ซ่อน BMS POS"),
    hideothers: posText("ซ่อนแอปอื่น"),
    unhide: posText("แสดงทั้งหมด"),
    quit: posText("ออกจากแอป"),
    filemenu: posText("ไฟล์"),
    editmenu: posText("แก้ไข"),
    windowmenu: posText("หน้าต่าง"),
    undo: posText("เลิกทำ"),
    redo: posText("ทำซ้ำ"),
    cut: posText("ตัด"),
    copy: posText("คัดลอก"),
    paste: posText("วาง"),
    pasteandmatchstyle: posText("วางและใช้รูปแบบปัจจุบัน"),
    delete: posText("ลบ"),
    selectall: posText("เลือกทั้งหมด"),
    close: posText("ปิดหน้าต่าง"),
    minimize: posText("ย่อหน้าต่าง"),
    zoom: posText("ขยายหน้าต่าง"),
    front: posText("นำหน้าต่างทั้งหมดมาด้านหน้า"),
    togglefullscreen: posText("สลับเต็มหน้าจอ"),
    toggledevtools: posText("เครื่องมือสำหรับนักพัฒนา"),
    startspeaking: posText("เริ่มอ่านออกเสียง"),
    stopspeaking: posText("หยุดอ่านออกเสียง"),
    toggletabbar: posText("แสดงแถบแท็บ"),
    selectnexttab: posText("แท็บถัดไป"),
    selectprevioustab: posText("แท็บก่อนหน้า"),
    showalltabs: posText("แสดงแท็บทั้งหมด"),
    mergeallwindows: posText("รวมหน้าต่างทั้งหมด"),
    movetabtonewwindow: posText("ย้ายแท็บไปหน้าต่างใหม่"),
    togglespellchecker: posText("ตรวจการสะกด"),
    showsubstitutions: posText("การแทนที่ข้อความ"),
    togglesmartquotes: posText("อัญประกาศอัจฉริยะ"),
    togglesmartdashes: posText("ขีดอัจฉริยะ"),
    toggletextreplacement: posText("แทนที่ข้อความ"),
  };
  for (const item of menu.items) {
    const role = String(item.role || "").toLowerCase();
    if (Object.hasOwn(labels, role)) item.label = labels[role];
    if (!role && item.submenu?.items.some(child => String(child.role).toLowerCase() === "startspeaking")) item.label = posText("การพูด");
    if (item.submenu) localizeNativeMenu(item.submenu);
  }
  return menu;
}
