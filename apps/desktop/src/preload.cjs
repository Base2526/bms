const { contextBridge, ipcRenderer } = require("electron/renderer");

const refreshListeners = new Set();
ipcRenderer.on("bms-pos:refresh-data", (_event, requestId) => {
  const listeners = Array.from(refreshListeners);
  for (const listener of listeners) {
    try { listener(); } catch {}
  }
  // Older web deployments do not register this listener. Tell the main process so it can fall
  // back to a normal reload instead of turning Command/Ctrl+R into a shortcut that does nothing.
  ipcRenderer.send("bms-pos:refresh-data-result", {
    requestId,
    handled: listeners.length > 0,
  });
});

contextBridge.exposeInMainWorld("bmsDesktop", {
  isDesktop: true,
  pair: (input) => ipcRenderer.invoke("bms-pos:pair", {
    serverUrl: typeof input?.serverUrl === "string" ? input.serverUrl : "",
    pairingInput: typeof input?.pairingInput === "string" ? input.pairingInput : "",
  }),
  retryStartup: () => ipcRenderer.invoke("bms-pos:retry-startup"),
  changeServer: () => ipcRenderer.invoke("bms-pos:change-server"),
  getDeviceToken: () => ipcRenderer.invoke("bms-pos:get-device-token"),
  getStorageNamespace: () => ipcRenderer.invoke("bms-pos:get-storage-namespace"),
  getCustomerDisplayState: () => ipcRenderer.invoke("bms-pos:get-customer-display-state"),
  setCustomerDisplayConfig: (input) => ipcRenderer.invoke("bms-pos:set-customer-display-config", {
    mode: typeof input?.mode === "string" ? input.mode : "",
    targetDisplayId: typeof input?.targetDisplayId === "string" ? input.targetDisplayId : null,
  }),
  identifyDisplays: () => ipcRenderer.invoke("bms-pos:identify-displays"),
  onCustomerDisplayStateChanged: (listener) => {
    if (typeof listener !== "function") return () => {};
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("bms-pos:customer-display-state-changed", handler);
    return () => ipcRenderer.removeListener("bms-pos:customer-display-state-changed", handler);
  },
  onRefreshRequested: (listener) => {
    if (typeof listener !== "function") return () => {};
    refreshListeners.add(listener);
    return () => refreshListeners.delete(listener);
  },
  // No renderer-supplied title/body: the native notification stays generic and can never leak
  // provider/customer/order data onto the operating-system lock screen.
  requestOperationalAttention: () => ipcRenderer.invoke("bms-pos:request-operational-attention"),
  unpair: () => ipcRenderer.invoke("bms-pos:unpair"),
  getAppInfo: () => ipcRenderer.invoke("bms-pos:app-info"),
});
