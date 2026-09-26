const { contextBridge } = require("electron/renderer");

contextBridge.exposeInMainWorld("bmsDesktop", {
  pair: async () => ({ ok: false, error: "smoke test" }),
  openLocalAdmin: async () => ({ ok: true }),
  retryStartup: async () => ({ ok: true }),
  changeServer: async () => ({ ok: true }),
  getAppInfo: async () => ({
    version: "0.2.1",
    platform: "darwin",
    clientLabel: "macOS Client",
    securityNote: "token ถูกเข้ารหัสด้วย macOS Keychain ของเครื่องนี้",
    secureStorageReady: true,
    secureStorageError: null,
    secureStorageBackend: null,
  }),
});
