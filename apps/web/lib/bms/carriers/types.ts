// =============================================================
// BMS Carrier clients — shared contract
// -------------------------------------------------------------
// This is a scaffold only: no Flash/Kerry API key exists yet, and their
// request/response shapes have not been verified against real docs (same
// caveat as the Lazada/Shopee webhook scaffold — see docs/integrations/lazada.md).
// Every client MUST behave safely with zero configuration: report
// "unconfigured" rather than throwing, so calling code (shipping.ts, future
// admin UI) can treat "no key yet" as a normal, expected state.
// =============================================================

export type CarrierClientStatus = "unconfigured" | "mock" | "not_implemented" | "configured";

export type CarrierTrackEvent = {
  /** Adapter-normalized status such as PICKED_UP, IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED, or RETURNED. */
  status: string;
  description: string;
  occurredAt: string;
};

export type CarrierTrackResult =
  // `source: "mock"` MUST stay on this type forever — it is the only thing that stops
  // a mock-mode dev override from ever being displayed as if it were real carrier data.
  | { ok: true; trackingNo: string; events: CarrierTrackEvent[]; source: "live" | "mock" }
  | { ok: false; reason: "unconfigured" }
  | { ok: false; reason: "not_implemented"; detail: string }
  | { ok: false; reason: "carrier_error"; detail: string };

export type CarrierRateRequest = {
  originProvince: string | null;
  destProvince: string | null;
  totalGrams: number | null;
  subtotal: number | null;
};

export type CarrierCreateShipmentItem = {
  sku: string;
  qty: number;
  weightGrams: number | null;
};

export type CarrierCreateShipmentRequest = {
  /** Stable across retries; live adapters must forward this through the carrier's idempotency mechanism. */
  idempotencyKey: string;
  orderId: string;
  shipFrom: {
    name: string | null;
    phone: string | null;
    address: string | null;
    province: string | null;
    postcode: string | null;
  };
  carrier: string;
  shipTo: {
    name: string | null;
    phone: string | null;
    address: string | null;
    province: string | null;
    postcode: string | null;
  };
  subtotal: number | null;
  totalGrams: number | null;
  items: CarrierCreateShipmentItem[];
};

export type CarrierCreateShipmentResult =
  | {
      ok: true;
      externalShipmentId: string;
      trackingNo: string | null;
      labelUrl: string | null;
      source: "live" | "mock";
    }
  | { ok: false; reason: "unconfigured" }
  | { ok: false; reason: "not_implemented"; detail: string }
  | { ok: false; reason: "carrier_error"; detail: string };

export type CarrierRateResult =
  // Same rule as CarrierTrackResult: `source` must stay on the success shape so a
  // mock-mode rate can never be presented to a customer as a real carrier price.
  | { ok: true; fee: number; currency: string; etaDays: number | null; source: "live" | "mock" }
  | { ok: false; reason: "unconfigured" }
  | { ok: false; reason: "not_implemented"; detail: string }
  | { ok: false; reason: "carrier_error"; detail: string };

export interface CarrierClient {
  readonly carrier: string;
  getStatus(): CarrierClientStatus;
  /** Create once per idempotencyKey. Never throws; callers still guard the external boundary. */
  createShipment?(req: CarrierCreateShipmentRequest): Promise<CarrierCreateShipmentResult>;
  /** Look up live tracking events from the carrier. Never throws — returns a typed result. */
  trackShipment(trackingNo: string): Promise<CarrierTrackResult>;
  /**
   * Ask the carrier what it would charge for this parcel. Optional because most
   * carriers here have no integration at all. Never throws — returns a typed result.
   */
  quoteRate?(req: CarrierRateRequest): Promise<CarrierRateResult>;
}
