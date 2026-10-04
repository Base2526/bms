"use client";

import { useSyncExternalStore } from "react";
import { canPrintDesktopReceipt, getPrinterSnapshot, getServerPrinterSnapshot, subscribePrinter } from "@/lib/pos/desktopPrinterClient";

export function useReceiptPrinter() {
  const snapshot = useSyncExternalStore(subscribePrinter, getPrinterSnapshot, getServerPrinterSnapshot);
  return { ...snapshot, disabled: !canPrintDesktopReceipt(snapshot) };
}
