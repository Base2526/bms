/** Platform-neutral navigation states shared by the native and desktop registers. */
export type PosClientStage =
  | "PAIRING"
  | "VERIFYING_DEVICE"
  | "CASHIER_LOGIN"
  | "SHIFT_REQUIRED"
  | "CATALOG"
  | "CHECKOUT"
  | "RECEIPT";

export type PosClientEvent =
  | "PAIRING_SAVED"
  | "DEVICE_VERIFIED"
  | "DEVICE_REJECTED"
  | "SHIFT_STATUS_OPEN"
  | "CASHIER_VERIFIED"
  | "SHIFT_OPENED"
  | "START_CHECKOUT"
  | "BACK_TO_CATALOG"
  | "SALE_COMPLETED"
  | "NEW_SALE"
  | "SIGN_OUT"
  | "UNPAIR";

export interface PosClientFlowState {
  stage: PosClientStage;
  paired: boolean;
  cashierAuthenticated: boolean;
  shiftOpen: boolean;
}

export const initialPosClientFlow = (paired: boolean): PosClientFlowState => ({
  stage: paired ? "VERIFYING_DEVICE" : "PAIRING",
  paired,
  cashierAuthenticated: false,
  shiftOpen: false,
});

/**
 * One flow for iOS, Android, macOS, Windows and Linux. UI navigation libraries are adapters;
 * this transition table is the product behaviour.
 */
export function transitionPosClientFlow(
  state: PosClientFlowState,
  event: PosClientEvent,
): PosClientFlowState {
  if (event === "UNPAIR" || event === "DEVICE_REJECTED") {
    return initialPosClientFlow(false);
  }
  if (event === "PAIRING_SAVED") {
    return initialPosClientFlow(true);
  }
  if (event === "DEVICE_VERIFIED") {
    return { ...state, paired: true, stage: "CASHIER_LOGIN" };
  }
  if (event === "SHIFT_STATUS_OPEN") {
    return {
      ...state,
      shiftOpen: true,
      stage: state.cashierAuthenticated ? "CATALOG" : state.stage,
    };
  }
  if (event === "SIGN_OUT") {
    return {
      ...state,
      stage: "CASHIER_LOGIN",
      cashierAuthenticated: false,
    };
  }
  if (event === "CASHIER_VERIFIED") {
    return {
      ...state,
      cashierAuthenticated: true,
      stage: state.shiftOpen ? "CATALOG" : "SHIFT_REQUIRED",
    };
  }
  if (event === "SHIFT_OPENED") {
    return state.cashierAuthenticated
      ? { ...state, shiftOpen: true, stage: "CATALOG" }
      : state;
  }
  if (event === "START_CHECKOUT" && state.cashierAuthenticated && state.shiftOpen) {
    return { ...state, stage: "CHECKOUT" };
  }
  if (event === "BACK_TO_CATALOG") {
    return { ...state, stage: "CATALOG" };
  }
  if (event === "SALE_COMPLETED") {
    return { ...state, stage: "RECEIPT" };
  }
  if (event === "NEW_SALE") {
    return { ...state, stage: "CATALOG" };
  }
  return state;
}
