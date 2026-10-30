"use client";

import { createContext, useContext } from "react";

// True only on a Retail Local install. The admin layout reads
// isRetailLocalDeployment() on the server and provides it here, so client
// pages can show Local-only copy without guessing from the URL or env.
const RetailLocalModeContext = createContext(false);

export const RetailLocalModeProvider = RetailLocalModeContext.Provider;

export function useRetailLocalMode(): boolean {
  return useContext(RetailLocalModeContext);
}
