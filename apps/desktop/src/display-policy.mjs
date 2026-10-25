export const CUSTOMER_DISPLAY_MODES = new Set(["off", "auto", "selected"]);

export const DEFAULT_CUSTOMER_DISPLAY_CONFIG = Object.freeze({
  version: 1,
  mode: "off",
  targetDisplayId: null,
  configured: false,
});

export function normalizeCustomerDisplayConfig(value) {
  if (!value || typeof value !== "object") return { ...DEFAULT_CUSTOMER_DISPLAY_CONFIG };
  if (!CUSTOMER_DISPLAY_MODES.has(value.mode)) return { ...DEFAULT_CUSTOMER_DISPLAY_CONFIG };
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
    configured: value.configured !== false,
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

/**
 * Keep the one-screen test window visibly inside the cashier work area. This is
 * deliberately windowed: a preview must never cover the register like the real
 * customer-display window does on a dedicated monitor.
 */
export function customerDisplayPreviewBounds(display) {
  const area = display?.workArea ?? display?.bounds;
  if (!area) throw new Error("DISPLAY_BOUNDS_MISSING");
  const width = Math.min(area.width, Math.max(480, Math.min(1024, area.width - 80)));
  const height = Math.min(area.height, Math.max(360, Math.min(768, area.height - 80)));
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  };
}
