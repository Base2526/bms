const { contextBridge } = require("electron/renderer");

contextBridge.exposeInMainWorld("bmsDesktop", {
  pair: async () => ({ ok: false, error: "smoke test" }),
  getAppInfo: async () => ({ version: "0.1.0", platform: "win32" }),
});
