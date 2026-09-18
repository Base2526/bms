const { contextBridge, ipcRenderer } = require("electron/renderer");

contextBridge.exposeInMainWorld("bmsDesktop", {
  isDesktop: true,
  pair: (input) => ipcRenderer.invoke("bms-pos:pair", {
    serverUrl: typeof input?.serverUrl === "string" ? input.serverUrl : "",
    pairingInput: typeof input?.pairingInput === "string" ? input.pairingInput : "",
  }),
  getDeviceToken: () => ipcRenderer.invoke("bms-pos:get-device-token"),
  getStorageNamespace: () => ipcRenderer.invoke("bms-pos:get-storage-namespace"),
  unpair: () => ipcRenderer.invoke("bms-pos:unpair"),
  getAppInfo: () => ipcRenderer.invoke("bms-pos:app-info"),
});
