const { contextBridge, ipcRenderer } = require("electron");

// Loaded only by the bundled file:// staff shell. The remote customer page has no preload.
contextBridge.exposeInMainWorld("bmsKiosk", Object.freeze({
  getState: () => ipcRenderer.invoke("kiosk:get-state"),
  validate: (input) => ipcRenderer.invoke("kiosk:validate", input),
  activate: () => ipcRenderer.invoke("kiosk:activate"),
  verifyPin: (pin) => ipcRenderer.invoke("kiosk:verify-pin", pin),
  cancelMaintenance: () => ipcRenderer.invoke("kiosk:cancel"),
  openMaintenance: () => ipcRenderer.invoke("kiosk:maintenance"),
  retry: () => ipcRenderer.invoke("kiosk:retry"),
}));
