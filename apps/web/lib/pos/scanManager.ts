/**
 * Keyboard-wedge scanner protocol + POS scan context routing.
 *
 * A Bluetooth HID scanner is indistinguishable from a keyboard once the browser
 * receives ordinary printable keys.  Global capture is therefore enabled only
 * for devices configured with a positive prefix key (for example F9).  The
 * legacy focus-owned input remains available for scanners without a prefix.
 */

export type ScanSource = "hid" | "camera" | "manual";

export type ScanContext =
  | "SALE"
  | "PRODUCT_LOOKUP"
  | "RETURN_RECEIPT"
  | "BLIND_RETURN_ITEM"
  | "STOCK_RECEIVE"
  | "DISABLED";

export type ScanContextInput = {
  tab: "sell" | "incoming" | "returns" | "stock" | "deposits" | "shift" | "settings";
  lookupMode: boolean;
  blindReturnOpen: boolean;
  hasPendingSale: boolean;
  busy: boolean;
  blockingOverlayOpen: boolean;
};

export function resolveScanContext(input: ScanContextInput): ScanContext {
  if (input.hasPendingSale || input.busy || input.blockingOverlayOpen) return "DISABLED";
  if (input.tab === "stock") return "STOCK_RECEIVE";
  if (input.tab === "returns") {
    return input.blindReturnOpen ? "BLIND_RETURN_ITEM" : "RETURN_RECEIPT";
  }
  if (input.tab === "sell") return input.lookupMode ? "PRODUCT_LOOKUP" : "SALE";
  return "DISABLED";
}

export type KeyboardWedgeConfig = {
  mode: "FOCUS" | "PREFIX";
  prefixKey: string;
  suffixKey: string;
  maxGapMs: number;
  minLength: number;
};

export const DEFAULT_KEYBOARD_WEDGE_CONFIG: KeyboardWedgeConfig = {
  mode: "FOCUS",
  prefixKey: "F9",
  suffixKey: "Enter",
  maxGapMs: 80,
  minLength: 3,
};

export type KeyboardWedgeState = {
  phase: "IDLE" | "CAPTURING" | "DISCARDING";
  buffer: string;
  lastKeyAt: number | null;
};

export const IDLE_KEYBOARD_WEDGE_STATE: KeyboardWedgeState = {
  phase: "IDLE",
  buffer: "",
  lastKeyAt: null,
};

export type KeyboardScanKey = {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
};

export type KeyboardWedgeResult = {
  state: KeyboardWedgeState;
  capture: boolean;
  completedCode?: string;
  rejected?: "TOO_SHORT" | "TOO_LONG" | "INVALID_KEY" | "TIMEOUT";
};

const MAX_SCAN_LENGTH = 128;
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "NumLock"]);

function idleResult(extra: Partial<KeyboardWedgeResult> = {}): KeyboardWedgeResult {
  return { state: IDLE_KEYBOARD_WEDGE_STATE, capture: false, ...extra };
}

/**
 * Pure state transition for a prefix-armed keyboard-wedge scanner.
 * `capture=true` means the caller must preventDefault/stopPropagation so the
 * scanner payload never mutates the currently focused form field.
 */
export function consumeKeyboardWedgeKey(
  state: KeyboardWedgeState,
  event: KeyboardScanKey,
  config: KeyboardWedgeConfig,
  now: number
): KeyboardWedgeResult {
  if (config.mode !== "PREFIX") return idleResult();

  if (state.phase === "IDLE") {
    if (event.isComposing) return idleResult();
    if (event.key !== config.prefixKey) return idleResult();
    return {
      state: { phase: "CAPTURING", buffer: "", lastKeyAt: now },
      capture: true,
    };
  }

  // Once the positive prefix has been consumed, no remainder of a malformed
  // scanner frame may leak into the focused field.  DISCARDING quarantines the
  // rest of that frame until its suffix (or Escape) arrives; a fresh prefix can
  // always start a clean frame immediately.
  if (state.phase === "DISCARDING") {
    if (event.key === "Escape" || event.key === config.suffixKey) {
      return { state: IDLE_KEYBOARD_WEDGE_STATE, capture: true };
    }
    if (event.key === config.prefixKey) {
      return {
        state: { phase: "CAPTURING", buffer: "", lastKeyAt: now },
        capture: true,
      };
    }
    return {
      state: { phase: "DISCARDING", buffer: "", lastKeyAt: now },
      capture: true,
    };
  }

  if (state.lastKeyAt != null && now - state.lastKeyAt > config.maxGapMs) {
    if (event.key === config.prefixKey) {
      return {
        state: { phase: "CAPTURING", buffer: "", lastKeyAt: now },
        capture: true,
        rejected: "TIMEOUT",
      };
    }
    if (event.key === "Escape" || event.key === config.suffixKey) {
      return { state: IDLE_KEYBOARD_WEDGE_STATE, capture: true, rejected: "TIMEOUT" };
    }
    return {
      state: { phase: "DISCARDING", buffer: "", lastKeyAt: now },
      capture: true,
      rejected: "TIMEOUT",
    };
  }

  if (event.key === "Escape") {
    return { state: IDLE_KEYBOARD_WEDGE_STATE, capture: true };
  }
  if (event.key === config.prefixKey) {
    return {
      state: { phase: "CAPTURING", buffer: "", lastKeyAt: now },
      capture: true,
    };
  }
  if (event.key === config.suffixKey) {
    const code = state.buffer.trim();
    if (code.length < config.minLength) {
      return { state: IDLE_KEYBOARD_WEDGE_STATE, capture: true, rejected: "TOO_SHORT" };
    }
    return {
      state: IDLE_KEYBOARD_WEDGE_STATE,
      capture: true,
      completedCode: code,
    };
  }
  if (MODIFIER_KEYS.has(event.key)) {
    return { state: { ...state, lastKeyAt: now }, capture: true };
  }
  if (event.key === "Backspace") {
    return {
      state: { phase: "CAPTURING", buffer: state.buffer.slice(0, -1), lastKeyAt: now },
      capture: true,
    };
  }
  if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.key.length !== 1) {
    return {
      state: { phase: "DISCARDING", buffer: "", lastKeyAt: now },
      capture: true,
      rejected: "INVALID_KEY",
    };
  }
  if (state.buffer.length >= MAX_SCAN_LENGTH) {
    return {
      state: { phase: "DISCARDING", buffer: "", lastKeyAt: now },
      capture: true,
      rejected: "TOO_LONG",
    };
  }
  return {
    state: { phase: "CAPTURING", buffer: state.buffer + event.key, lastKeyAt: now },
    capture: true,
  };
}

export const SCAN_CONTEXT_LABEL_TH: Record<ScanContext, string> = {
  SALE: "ขาย → ตะกร้า",
  PRODUCT_LOOKUP: "เช็คสินค้า",
  RETURN_RECEIPT: "ค้นใบเสร็จ",
  BLIND_RETURN_ITEM: "รับของคืน",
  STOCK_RECEIVE: "รับเข้าสต็อก",
  DISABLED: "พักการสแกน",
};
