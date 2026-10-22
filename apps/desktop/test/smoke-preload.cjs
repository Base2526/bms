const { contextBridge, ipcRenderer } = require("electron/renderer");

contextBridge.exposeInMainWorld("bmsDesktop", {
  pair: async () => ({ ok: false, error: "smoke test" }),
  getSetupAdminTarget: async () => ({ kind: "local" }),
  openSetupAdmin: async () => ({ ok: true, kind: "local" }),
  retryStartup: async () => ({ ok: true }),
  changeServer: async () => ({ ok: true }),
  getAppInfo: () => ipcRenderer.invoke("smoke:app-info"),
});
