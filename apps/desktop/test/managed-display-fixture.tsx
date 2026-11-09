import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import ManagedDisplaySettings from "../../web/components/pos-desktop/ManagedDisplaySettings";
import { PickupQueueSettings } from "../../web/components/pos/PickupQueuePanel";
import type {
  DesktopCustomerDisplayState,
  DesktopExternalDisplayRole,
  DesktopManagedDisplayState,
} from "../../web/lib/pos/deviceTokenClient";

const displays = [
  { id: "10", label: "Built-in", primary: true, cashier: true, width: 1440, height: 900, scaleFactor: 1, rotation: 0 },
  { id: "20", label: "HDMI", primary: false, cashier: false, width: 1920, height: 1080, scaleFactor: 1, rotation: 0 },
];

const off = (): DesktopCustomerDisplayState => ({
  mode: "off", targetDisplayId: null, activeDisplayId: null, open: false,
  cashierDisplayId: "10", displays, targetAvailable: false, positioningLimited: false,
});

const open = (): DesktopCustomerDisplayState => ({
  mode: "auto", targetDisplayId: null, activeDisplayId: "20", open: true,
  cashierDisplayId: "10", displays, targetAvailable: true, positioningLimited: false,
});

const preview = (): DesktopCustomerDisplayState => ({
  mode: "off", targetDisplayId: null, activeDisplayId: "10", open: true, preview: true,
  cashierDisplayId: "10", displays, targetAvailable: false, positioningLimited: false,
});

let state: DesktopManagedDisplayState = { customer: open(), queue: off() };
const customerListeners = new Set<(value: DesktopCustomerDisplayState) => void>();
const queueListeners = new Set<(value: DesktopCustomerDisplayState) => void>();

function emit() {
  customerListeners.forEach((listener) => listener(state.customer));
  queueListeners.forEach((listener) => listener(state.queue));
}

Object.defineProperty(window, "bmsDesktop", { value: {
  isDesktop: true,
  getDeviceToken: async () => "fixture-token",
  getStorageNamespace: async () => "fixture",
  unpair: async () => ({ ok: true }),
  getCustomerDisplayState: async () => state.customer,
  getQueueDisplayState: async () => state.queue,
  setCustomerDisplayConfig: async () => ({ ok: true, state: state.customer }),
  setQueueDisplayConfig: async () => ({ ok: true, state: state.queue }),
  identifyDisplays: async () => ({ ok: true }),
  onCustomerDisplayStateChanged: (listener: (value: DesktopCustomerDisplayState) => void) => {
    customerListeners.add(listener); return () => customerListeners.delete(listener);
  },
  onQueueDisplayStateChanged: (listener: (value: DesktopCustomerDisplayState) => void) => {
    queueListeners.add(listener); return () => queueListeners.delete(listener);
  },
  setExternalDisplayRole: async (input: { role: DesktopExternalDisplayRole; mode: string }) => {
    if (input.mode === "off") {
      state = { ...state, [input.role]: off() };
    } else if (input.role === "customer") {
      state = { customer: open(), queue: off() };
    } else {
      state = { customer: off(), queue: open() };
    }
    emit();
    return { ok: true, state };
  },
  openCustomerDisplayPreview: async () => {
    state = { ...state, customer: preview() }; emit();
    return { ok: true, state: state.customer };
  },
  closeCustomerDisplayPreview: async () => {
    state = { ...state, customer: off() }; emit();
    return { ok: true, state: state.customer };
  },
  openQueueDisplayPreview: async () => {
    state = { ...state, queue: preview() }; emit();
    return { ok: true, state: state.queue };
  },
  closeQueueDisplayPreview: async () => {
    state = { ...state, queue: off() }; emit();
    return { ok: true, state: state.queue };
  },
}, configurable: true });

function Fixture() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return <main style={{ maxWidth: 1060, margin: "0 auto", padding: 20 }}>
    {ready && <>
      <ManagedDisplaySettings />
      <PickupQueueSettings enabled={true} managedDisplay={true} onChange={() => undefined} />
    </>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
