import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import ManagedDisplaySettings from "../../web/components/pos-desktop/ManagedDisplaySettings";
import { PickupQueueSettings } from "../../web/components/pos/PickupQueuePanel";
import type {
  DesktopCustomerDisplayState,
  DesktopExternalDisplayRole,
  DesktopManagedDisplayState,
  DesktopQueueDisplayState,
} from "../../web/lib/pos/deviceTokenClient";

const multiMode = new URLSearchParams(location.search).get("multi");
const multiEnabled = multiMode !== null;
const displays = [
  { id: "10", label: "Built-in", primary: true, cashier: true, width: 1440, height: 900, scaleFactor: 1, rotation: 0 },
  { id: "20", label: "HDMI", primary: false, cashier: false, width: 1920, height: 1080, scaleFactor: 1, rotation: 0 },
  ...(multiEnabled && multiMode !== "single" && multiMode !== "waiting" ? [
    { id: "30", label: "TV Front", primary: false, cashier: false, width: 1920, height: 1080, scaleFactor: 1, rotation: 0 },
    { id: "40", label: "TV Pickup", primary: false, cashier: false, width: 1280, height: 720, scaleFactor: 1, rotation: 0 },
  ] : []),
  ...(multiMode === "many" ? [
    { id: "50", label: "TV Side", primary: false, cashier: false, width: 1280, height: 720, scaleFactor: 1, rotation: 0 },
    { id: "60", label: "TV Rear", primary: false, cashier: false, width: 1280, height: 720, scaleFactor: 1, rotation: 0 },
  ] : []),
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

function multiQueue(mode: "off" | "auto" | "selected", ids: string[] = [], count = 1,
  audioDisplayId: string | null = null, customerDisplayId: string | null = "20"): DesktopQueueDisplayState {
  const eligible = displays.filter((display) => !display.cashier && display.id !== customerDisplayId);
  const requested = mode === "selected" ? ids : mode === "auto" ? eligible.slice(0, count).map((item) => item.id) : [];
  const active = requested.filter((id) => eligible.some((item) => item.id === id));
  const owner = active.includes(audioDisplayId ?? "") ? audioDisplayId : active[0] ?? null;
  return { ...off(), mode, targetDisplayIds: ids, displayCount: mode === "selected" ? ids.length : count,
    maxDisplays: 32, preferredAudioDisplayId: audioDisplayId, audioDisplayId: owner,
    activeDisplayIds: active, activeDisplayId: active[0] ?? null, open: active.length > 0,
    targetAvailable: active.length > 0, screens: requested.map((id) => ({ id,
      label: displays.find((display) => display.id === id)?.label ?? "Saved screen",
      connected: displays.some((display) => display.id === id), open: active.includes(id), audio: owner === id })) };
}

let state: DesktopManagedDisplayState = { customer: open(), queue: multiMode === "waiting"
  ? multiQueue("auto") : multiEnabled ? multiQueue("off") : off() };
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
  setQueueDisplaysConfig: async (input: { mode: "off" | "auto" | "selected";
    displayCount: number; targetDisplayIds: string[]; audioDisplayId: string | null }) => {
    const handoff = input.mode !== "off" && state.customer.mode !== "off"
      && (displays.filter((display) => !display.cashier).length === 1
        || (input.mode === "selected" && input.targetDisplayIds.includes(state.customer.activeDisplayId ?? "")));
    const customer = handoff ? off() : state.customer;
    state = { customer, queue: multiQueue(input.mode, input.targetDisplayIds,
      input.displayCount, input.audioDisplayId, customer.activeDisplayId) }; emit();
    return { ok: true, state };
  },
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
