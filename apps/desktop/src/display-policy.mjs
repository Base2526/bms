export const CUSTOMER_DISPLAY_MODES = new Set(["off", "auto", "selected"]);

export const DEFAULT_CUSTOMER_DISPLAY_CONFIG = Object.freeze({
  version: 1,
  mode: "off",
  targetDisplayId: null,
  configured: false,
});

// Guard malformed saved/IPC input; the operator's choices are limited by detected monitors.
export const MAX_QUEUE_DISPLAYS = 32;
export const DEFAULT_QUEUE_DISPLAY_CONFIG = Object.freeze({
  version: 2,
  mode: "off",
  targetDisplayId: null,
  targetDisplayIds: [],
  displayCount: 1,
  audioDisplayId: null,
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

/** Upgrade the existing single-screen file without turning on additional monitors. */
export function normalizeQueueDisplayConfig(value) {
  if (!value || typeof value !== "object" || !CUSTOMER_DISPLAY_MODES.has(value.mode)) {
    return { ...DEFAULT_QUEUE_DISPLAY_CONFIG, targetDisplayIds: [] };
  }
  const mode = value.mode;
  const rawIds = Array.isArray(value.targetDisplayIds)
    ? value.targetDisplayIds
    : value.targetDisplayId == null ? [] : [value.targetDisplayId];
  const ids = [...new Set(rawIds.filter((id) => typeof id === "string")
    .map((id) => id.trim()).filter(Boolean))].slice(0, MAX_QUEUE_DISPLAYS);
  if (mode === "selected" && ids.length === 0) {
    return { ...DEFAULT_QUEUE_DISPLAY_CONFIG, targetDisplayIds: [] };
  }
  const rawCount = Number(value.displayCount);
  const count = Number.isInteger(rawCount) && rawCount >= 1 && rawCount <= MAX_QUEUE_DISPLAYS
    ? rawCount : 1;
  const requestedAudioId = typeof value.audioDisplayId === "string"
    ? value.audioDisplayId.trim() || null : null;
  const audioDisplayId = mode === "selected" && requestedAudioId && !ids.includes(requestedAudioId)
    ? null : requestedAudioId;
  return {
    version: 2,
    mode,
    targetDisplayId: mode === "selected" ? ids[0] : null,
    targetDisplayIds: mode === "selected" ? ids : [],
    displayCount: mode === "selected" ? ids.length : count,
    audioDisplayId,
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

/** Queue auto-selection also excludes a monitor already owned by the customer display. */
export function selectQueueDisplays(displays, cashierDisplayId, customerDisplayId, config) {
  const normalized = normalizeQueueDisplayConfig(config);
  if (normalized.mode === "off") return [];
  const reserved = customerDisplayId == null ? null : String(customerDisplayId);
  const available = displays.filter((display) =>
    String(display.id) !== String(cashierDisplayId)
    && String(display.id) !== reserved);
  if (normalized.mode === "selected") {
    return normalized.targetDisplayIds.flatMap((id) => {
      const match = available.find((display) => String(display.id) === id);
      return match ? [match] : [];
    });
  }
  return available.slice(0, normalized.displayCount);
}

/** Legacy callers still ask for one screen. */
export function selectQueueDisplay(displays, cashierDisplayId, customerDisplayId, config) {
  return selectQueueDisplays(displays, cashierDisplayId, customerDisplayId, config)[0] ?? null;
}

/** An explicit queue setup takes the only external screen, or a selected customer screen. */
export function queueClaimsCustomerDisplay(displays, cashierDisplayId, customerConfig, queueConfig) {
  const queue = normalizeQueueDisplayConfig(queueConfig);
  const customer = normalizeCustomerDisplayConfig(customerConfig);
  if (queue.mode === "off" || customer.mode === "off") return false;
  const external = displays.filter((display) => String(display.id) !== String(cashierDisplayId));
  if (external.length === 1 && queue.mode === "auto") return true;
  if (queue.mode !== "selected") return false;
  const customerTarget = selectCustomerDisplay(displays, cashierDisplayId, customer);
  return (customerTarget && queue.targetDisplayIds.includes(String(customerTarget.id)))
    || (customer.mode === "selected" && queue.targetDisplayIds.includes(customer.targetDisplayId));
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
