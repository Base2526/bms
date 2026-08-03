// =============================================================
// Kerry Express client — scaffold, not wired to a real key yet
// -------------------------------------------------------------
// Expected env vars (set in .env.dev / .env.prod when a key exists):
//   KERRY_API_KEY
//   KERRY_ACCOUNT_ID
// Do NOT invent request/response shapes here — Kerry's actual tracking
// endpoint, auth header, and payload format must come from their real
// merchant API docs once we have a key. Until then this client only
// reports whether it is configured.
//
// KERRY_MOCK=true (dev/test only, ignored in production — see mock.ts)
// simulates a full "connected + tracking" flow with fake, clearly-tagged
// data so the rest of the shipping flow can be exercised end to end
// before a real key exists.
// =============================================================

import type { CarrierClient, CarrierRateRequest, CarrierRateResult, CarrierTrackResult } from "./types";
import { buildMockRateResult, buildMockTrackResult, mockModeAllowed } from "./mock";

function isMockEnabled(): boolean {
  return mockModeAllowed() && process.env.KERRY_MOCK === "true";
}

function isConfigured(): boolean {
  return isMockEnabled() || Boolean(process.env.KERRY_API_KEY && process.env.KERRY_ACCOUNT_ID);
}

export const kerryClient: CarrierClient = {
  carrier: "KERRY",

  getStatus() {
    return isConfigured() ? "configured" : "unconfigured";
  },

  async trackShipment(trackingNo: string): Promise<CarrierTrackResult> {
    if (isMockEnabled()) return buildMockTrackResult("KERRY", trackingNo);
    if (!isConfigured()) return { ok: false, reason: "unconfigured" };
    return {
      ok: false,
      reason: "not_implemented",
      detail:
        "KERRY_API_KEY is set, but the tracking request/response shape has not been verified against Kerry Express's real API docs yet.",
    };
  },

  async quoteRate(req: CarrierRateRequest): Promise<CarrierRateResult> {
    if (isMockEnabled()) return buildMockRateResult("KERRY", req);
    if (!isConfigured()) return { ok: false, reason: "unconfigured" };
    return {
      ok: false,
      reason: "not_implemented",
      detail:
        "KERRY_API_KEY is set, but Kerry Express's rate/pricing endpoint has not been verified against their real API docs yet.",
    };
  },
};
