const { contextBridge, ipcRenderer } = require("electron/renderer");

contextBridge.exposeInMainWorld("bmsDesktop", {
  pair: async () => ({ ok: false, error: "smoke test" }),
  getSetupAdminTarget: async () => ({ kind: "local" }),
  openSetupAdmin: async () => ({ ok: true, kind: "local" }),
  retryStartup: async () => ({ ok: false, error: "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่" }),
  changeServer: async () => ({ ok: false, error: "ลบข้อมูลจับคู่ไม่สำเร็จ ข้อมูลเดิมยังอยู่" }),
  getAppInfo: () => ipcRenderer.invoke("smoke:app-info"),
});
