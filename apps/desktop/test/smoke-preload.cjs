const { contextBridge } = require("electron/renderer");

contextBridge.exposeInMainWorld("bmsDesktop", {
  pair: async () => ({ ok: false, error: "smoke test" }),
  getAppInfo: async () => ({
    version: "0.2.1",
    platform: "win32",
    clientLabel: "Windows Client",
    securityNote: "token ถูกเข้ารหัสด้วยบัญชี Windows ของเครื่องนี้",
    secureStorageReady: true,
    secureStorageError: null,
    secureStorageBackend: null,
  }),
});
