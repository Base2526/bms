export const CUSTOMER_DISPLAY_MODES = new Set(["off", "auto", "selected"]);

export const DEFAULT_CUSTOMER_DISPLAY_CONFIG = Object.freeze({
  version: 1,
  mode: "off",
  targetDisplayId: null,
  configured: false,
});

// The pickup call screen follows the same persisted policy as the customer display, but keeps a
// separate file/state so a three-screen counter can dedicate one monitor to each purpose.
export const DEFAULT_QUEUE_DISPLAY_CONFIG = DEFAULT_CUSTOMER_DISPLAY_CONFIG;

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

export const normalizeQueueDisplayConfig = normalizeCustomerDisplayConfig;

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

/** Queue auto-selection also excludes a monitor already owned by the customer display. */
export function selectQueueDisplay(displays, cashierDisplayId, customerDisplayId, config) {
  const reserved = customerDisplayId == null ? null : String(customerDisplayId);
  return selectCustomerDisplay(
    displays.filter((display) => String(display.id) !== reserved),
    cashierDisplayId,
    config,
  );
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

/**
 * Keep the queue preview visibly separate when the customer preview is open too. The windows stay
 * large enough to test the real layouts, but the second title bar remains reachable on one screen.
 */
export function queueDisplayPreviewBounds(display) {
  const area = display?.workArea ?? display?.bounds;
  if (!area) throw new Error("DISPLAY_BOUNDS_MISSING");
  const bounds = customerDisplayPreviewBounds(display);
  const horizontalRoom = Math.max(0, area.x + area.width - bounds.x - bounds.width);
  const verticalRoom = Math.max(0, area.y + area.height - bounds.y - bounds.height);
  const offset = Math.min(56, horizontalRoom, verticalRoom);
  return { ...bounds, x: bounds.x + offset, y: bounds.y + offset };
}
