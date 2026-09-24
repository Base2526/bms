"use client";

import { createContext } from "react";

export type PosTab =
  | "sell"
  | "boardgame"
  | "incoming"
  | "returns"
  | "stock"
  | "deposits"
  | "shift"
  | "settings";

export type PosServiceCallNotice = {
  id: string;
  source: "restaurant" | "boardgame";
  tableCode: string;
  tableName: string;
  requestCode: string;
  requestNote: string | null;
  status: "PENDING" | "ACKNOWLEDGED";
  createdAt: string;
};

/** Minimal incoming-order shape the restaurant shell needs for its persistent bell/banner. */
export type PosIncomingOrderNotice = {
  id: string;
  channel: string;
  status: "PAID" | "PACKING";
  provider: "GRABFOOD" | "LINEMAN" | "FOODPANDA" | null;
  providerDisplayNumber: string | null;
  deliveryStatus: string | null;
  providerStatus: string | null;
  providerCommandStatus: string | null;
  acceptanceDeadlineAt: string | null;
  scheduledFulfillmentAt: string | null;
  createdAt: string;
};

export type PosIncomingOrdersSnapshot = {
  orders: PosIncomingOrderNotice[];
  restaurantOrdersPaused: boolean;
  /** Branch row controlled by the POS toggle, not the effective multi-scope state. */
  deliveryPlatformsPaused: boolean;
  deliveryIntakeState: "ACCEPTING" | "PARTIAL" | "PAUSED";
  deliveryPauseControlledElsewhere: boolean;
  deliveryPauseNeedsManualAction: boolean;
};

export type PosWorkspaceOptions = {
  embedded: boolean;
  initialTab: PosTab;
  initialToken: string;
  initialCashierId: string;
  initialPin: string;
  /** Increments when the Desktop shell requests an in-place authoritative refresh. */
  refreshSignal?: number;
  onTabChange?: (tab: PosTab) => void;
  onShiftChange?: (open: boolean) => void;
  onUnpair?: () => void | Promise<void>;
  /** The desktop shell owns the customer-display payload while this legacy workspace is embedded. */
  suppressCustomerDisplay?: boolean;
  /**
   * Desktop owns the mobile-style checkout screen. Embedded workspaces hand a frozen
   * board-game billing-group id back to that shell instead of opening the legacy sell pane.
   */
  onBoardGameCheckout?: (billingGroupId: string) => void | Promise<void>;
  /** Feeds the persistent desktop notification bell without polling the board-game workspace twice. */
  onServiceCallsChange?: (calls: PosServiceCallNotice[]) => void;
  /** Feeds the restaurant shell bell/intake state while the embedded incoming workspace owns polling. */
  onIncomingOrdersChange?: (snapshot: PosIncomingOrdersSnapshot) => void;
};

export const PosWorkspaceContext = createContext<PosWorkspaceOptions>({
  embedded: false,
  initialTab: "sell",
  initialToken: "",
  initialCashierId: "",
  initialPin: "",
});
