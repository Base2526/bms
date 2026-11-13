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
  getLanguage: () => ipcRenderer.invoke('bms-pos:get-language'),
  setLanguage: (language) => ipcRenderer.invoke('bms-pos:set-language', language === 'th' || language === 'en' ? language : null),
  onLanguageChanged: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event, language) => { if (language === 'th' || language === 'en') listener(language); };
    ipcRenderer.on('bms-pos:language-changed', handler);
    return () => ipcRenderer.removeListener('bms-pos:language-changed', handler);
  },
  pair: (input) => ipcRenderer.invoke("bms-pos:pair", {
    serverUrl: typeof input?.serverUrl === "string" ? input.serverUrl : "",
    pairingInput: typeof input?.pairingInput === "string" ? input.pairingInput : "",
  }),
  getSetupAdminTarget: () => ipcRenderer.invoke("bms-pos:setup-admin-target"),
  openSetupAdmin: () => ipcRenderer.invoke("bms-pos:open-setup-admin"),
  retryStartup: () => ipcRenderer.invoke("bms-pos:retry-startup"),
  changeServer: () => ipcRenderer.invoke("bms-pos:change-server"),
  getDeviceToken: () => ipcRenderer.invoke("bms-pos:get-device-token"),
  getStorageNamespace: () => ipcRenderer.invoke("bms-pos:get-storage-namespace"),
  openAdmin: () => ipcRenderer.invoke("bms-pos:open-admin"),
  getPrinterState: () => ipcRenderer.invoke("bms-pos:get-printer-state"),
  setPrinterConfig: (input) => ipcRenderer.invoke("bms-pos:set-printer-config", {
    deviceName: typeof input?.deviceName === "string" ? input.deviceName : "",
    paperWidth: input?.paperWidth,
  }),
  printReceipt: () => ipcRenderer.invoke("bms-pos:print-receipt"),
  testReceiptPrinter: () => ipcRenderer.invoke("bms-pos:test-receipt-printer"),
  confirmPrinterTest: (printed) => ipcRenderer.invoke("bms-pos:confirm-printer-test", printed === true),
  getKitchenPrinterState: () => ipcRenderer.invoke("bms-pos:get-kitchen-printer-state"),
  setKitchenPrinterConfig: (input) => ipcRenderer.invoke("bms-pos:set-kitchen-printer-config", {
    routes: Array.isArray(input?.routes) ? input.routes.slice(0, 32).map((route) => ({
      stationKey: typeof route?.stationKey === "string" ? route.stationKey : "",
      stationName: typeof route?.stationName === "string" ? route.stationName : "",
      deviceName: typeof route?.deviceName === "string" ? route.deviceName : "",
      paperWidth: route?.paperWidth,
      autoPrint: route?.autoPrint === true,
    })) : [],
  }),
  testKitchenPrinter: (stationKey) => ipcRenderer.invoke("bms-pos:test-kitchen-printer", typeof stationKey === "string" ? stationKey : ""),
  printKitchenTicket: (job, options) => ipcRenderer.invoke("bms-pos:print-kitchen-ticket", {
    jobId: typeof job?.jobId === "string" ? job.jobId : "",
    stationId: typeof job?.stationId === "string" ? job.stationId : null,
    stationName: typeof job?.stationName === "string" ? job.stationName : null,
    label: typeof job?.label === "string" ? job.label : "",
    roundNo: job?.roundNo,
    createdAt: typeof job?.createdAt === "string" ? job.createdAt : "",
    items: Array.isArray(job?.items) ? job.items.slice(0, 80).map((item) => ({
      name: typeof item?.name === "string" ? item.name : "",
      size: typeof item?.size === "string" ? item.size : "",
      qty: item?.qty,
      modifiers: Array.isArray(item?.modifiers) ? item.modifiers.slice(0, 20) : [],
      note: typeof item?.note === "string" ? item.note : "",
    })) : [],
  }, { auto: options?.auto === true, retry: options?.retry === true }),
  getCustomerDisplayState: () => ipcRenderer.invoke("bms-pos:get-customer-display-state"),
  openCustomerDisplayPreview: () => ipcRenderer.invoke("bms-pos:open-customer-display-preview"),
  closeCustomerDisplayPreview: () => ipcRenderer.invoke("bms-pos:close-customer-display-preview"),
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
  getQueueDisplayState: () => ipcRenderer.invoke("bms-pos:get-queue-display-state"),
  openQueueDisplayPreview: () => ipcRenderer.invoke("bms-pos:open-queue-display-preview"),
  closeQueueDisplayPreview: () => ipcRenderer.invoke("bms-pos:close-queue-display-preview"),
  setQueueDisplayConfig: (input) => ipcRenderer.invoke("bms-pos:set-queue-display-config", {
    mode: typeof input?.mode === "string" ? input.mode : "",
    targetDisplayId: typeof input?.targetDisplayId === "string" ? input.targetDisplayId : null,
  }),
  setExternalDisplayRole: (input) => ipcRenderer.invoke("bms-pos:set-external-display-role", {
    role: input?.role === "customer" || input?.role === "queue" ? input.role : "",
    mode: typeof input?.mode === "string" ? input.mode : "",
    targetDisplayId: typeof input?.targetDisplayId === "string" ? input.targetDisplayId : null,
  }),
  onQueueDisplayStateChanged: (listener) => {
    if (typeof listener !== "function") return () => {};
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("bms-pos:queue-display-state-changed", handler);
    return () => ipcRenderer.removeListener("bms-pos:queue-display-state-changed", handler);
  },
  onRefreshRequested: (listener) => {
    if (typeof listener !== "function") return () => {};
    refreshListeners.add(listener);
    return () => refreshListeners.delete(listener);
  },
  // No renderer-supplied title/body: the native notification stays generic and can never leak
  // provider/customer/order data onto the operating-system lock screen.
  requestOperationalAttention: () => ipcRenderer.invoke("bms-pos:request-operational-attention"),
  unpair: async (afterRemoval) => {
    const deferSetup = typeof afterRemoval === "function";
    const result = await ipcRenderer.invoke("bms-pos:unpair", { deferSetup });
    if (result?.ok && deferSetup) {
      try { await afterRemoval(); }
      finally {
        // Removal already succeeded; a navigation/renderer shutdown cannot turn it into failure.
        await ipcRenderer.invoke("bms-pos:complete-unpair").catch(() => {});
      }
    }
    return result;
  },
  getAppInfo: () => ipcRenderer.invoke("bms-pos:app-info"),
});
