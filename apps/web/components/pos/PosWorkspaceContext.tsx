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

export type PosWorkspaceOptions = {
  embedded: boolean;
  initialTab: PosTab;
  initialToken: string;
  initialCashierId: string;
  initialPin: string;
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
};

export const PosWorkspaceContext = createContext<PosWorkspaceOptions>({
  embedded: false,
  initialTab: "sell",
  initialToken: "",
  initialCashierId: "",
  initialPin: "",
});
