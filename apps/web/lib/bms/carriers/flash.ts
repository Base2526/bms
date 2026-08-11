// =============================================================
// Flash Express client — scaffold, not wired to a real key yet
// -------------------------------------------------------------
// Expected env vars (set in .env.dev / .env.prod when a key exists):
//   FLASH_API_KEY
//   FLASH_MERCHANT_ID
// Do NOT invent request/response shapes here — Flash's actual tracking
// endpoint, auth header, and payload format must come from their real
// merchant API docs once we have a key. Until then this client only
// reports whether it is configured.
//
// FLASH_MOCK=true (dev/test only, ignored in production — see mock.ts)
// simulates a full "connected + tracking" flow with fake, clearly-tagged
// data so the rest of the shipping flow can be exercised end to end
// before a real key exists.
// =============================================================

import type {
  CarrierClient,
  CarrierCreateShipmentRequest,
  CarrierCreateShipmentResult,
  CarrierRateRequest,
  CarrierRateResult,
  CarrierTrackResult,
} from "./types";
import { buildMockCreateShipmentResult, buildMockRateResult, buildMockTrackResult, mockModeAllowed } from "./mock";

function isMockEnabled(): boolean {
  return mockModeAllowed() && process.env.FLASH_MOCK === "true";
}

function isConfigured(): boolean {
  return isMockEnabled() || Boolean(process.env.FLASH_API_KEY && process.env.FLASH_MERCHANT_ID);
}

export const flashClient: CarrierClient = {
  carrier: "FLASH",

  getStatus() {
    return isConfigured() ? "configured" : "unconfigured";
  },

  async createShipment(req: CarrierCreateShipmentRequest): Promise<CarrierCreateShipmentResult> {
    if (isMockEnabled()) return buildMockCreateShipmentResult("FLASH", req);
    if (!isConfigured()) return { ok: false, reason: "unconfigured" };
    return {
      ok: false,
      reason: "not_implemented",
      detail:
        "FLASH_API_KEY is set, but the shipment creation request/response shape has not been verified against Flash Express's real API docs yet.",
    };
  },

  async trackShipment(trackingNo: string): Promise<CarrierTrackResult> {
    if (isMockEnabled()) return buildMockTrackResult("FLASH", trackingNo);
    if (!isConfigured()) return { ok: false, reason: "unconfigured" };
    return {
      ok: false,
      reason: "not_implemented",
      detail:
        "FLASH_API_KEY is set, but the tracking request/response shape has not been verified against Flash Express's real API docs yet.",
    };
  },

  async quoteRate(req: CarrierRateRequest): Promise<CarrierRateResult> {
    if (isMockEnabled()) return buildMockRateResult("FLASH", req);
    if (!isConfigured()) return { ok: false, reason: "unconfigured" };
    return {
      ok: false,
      reason: "not_implemented",
      detail:
        "FLASH_API_KEY is set, but Flash Express's rate/pricing endpoint has not been verified against their real API docs yet.",
    };
  },
};
