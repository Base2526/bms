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

export type PosWorkspaceOptions = {
  embedded: boolean;
  initialTab: PosTab;
  initialToken: string;
  initialCashierId: string;
  initialPin: string;
  onTabChange?: (tab: PosTab) => void;
  onShiftChange?: (open: boolean) => void;
  onUnpair?: () => void | Promise<void>;
};

export const PosWorkspaceContext = createContext<PosWorkspaceOptions>({
  embedded: false,
  initialTab: "sell",
  initialToken: "",
  initialCashierId: "",
  initialPin: "",
});
