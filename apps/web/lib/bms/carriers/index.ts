// =============================================================
// Carrier client registry
// -------------------------------------------------------------
// Only FLASH and KERRY have a client scaffold so far. DHL/AUSPOST/NZPOST/
// OTHER (see CARRIERS in ../shipping.ts) stay manual — no client requested
// for them yet.
// =============================================================

import type { Carrier } from "./constants";
import type { CarrierClient } from "./types";
import { flashClient } from "./flash";
import { kerryClient } from "./kerry";

const REGISTRY: Partial<Record<Carrier, CarrierClient>> = {
  FLASH: flashClient,
  KERRY: kerryClient,
};

/** Returns the client for a carrier, or null if that carrier has no API integration at all. */
export function getCarrierClient(carrier: Carrier): CarrierClient | null {
  return REGISTRY[carrier] ?? null;
}

export type {
  CarrierClient,
  CarrierClientStatus,
  CarrierTrackResult,
  CarrierTrackEvent,
  CarrierRateRequest,
  CarrierRateResult,
} from "./types";
