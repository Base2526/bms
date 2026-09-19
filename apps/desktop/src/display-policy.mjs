export const CUSTOMER_DISPLAY_MODES = new Set(["off", "auto", "selected"]);

export const DEFAULT_CUSTOMER_DISPLAY_CONFIG = Object.freeze({
  version: 1,
  mode: "off",
  targetDisplayId: null,
});

export function normalizeCustomerDisplayConfig(value) {
  if (!value || typeof value !== "object") return { ...DEFAULT_CUSTOMER_DISPLAY_CONFIG };
  const mode = CUSTOMER_DISPLAY_MODES.has(value.mode) ? value.mode : "off";
  const targetDisplayId = value.targetDisplayId == null
    ? null
    : String(value.targetDisplayId).trim() || null;
  if (mode === "selected" && !targetDisplayId) {
    return { ...DEFAULT_CUSTOMER_DISPLAY_CONFIG };
  }
  return {
    version: 1,
    mode,
    targetDisplayId: mode === "selected" ? targetDisplayId : null,
  };
}

export function selectCustomerDisplay(displays, cashierDisplayId, config) {
  const normalized = normalizeCustomerDisplayConfig(config);
  if (normalized.mode === "off") return null;
  const cashierId = cashierDisplayId == null ? null : String(cashierDisplayId);
  if (normalized.mode === "selected") {
    return displays.find((display) => (
      String(display.id) === normalized.targetDisplayId
      && String(display.id) !== cashierId
    )) ?? null;
  }
  return displays.find((display) => String(display.id) !== cashierId) ?? null;
}
