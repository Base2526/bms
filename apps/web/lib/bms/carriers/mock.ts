// =============================================================
// Carrier mock-mode helper — dev/test only, never real carrier data
// -------------------------------------------------------------
// Lets FLASH_MOCK / KERRY_MOCK simulate a full "connected + tracking" flow
// before we have real API keys or docs. Deterministic per tracking number
// (same input -> same fake timeline) so tests are reproducible, and always
// tagged source:"mock" so it can never be mistaken for live carrier data.
// =============================================================

import type {
  CarrierCreateShipmentRequest,
  CarrierCreateShipmentResult,
  CarrierRateRequest,
  CarrierRateResult,
  CarrierTrackEvent,
  CarrierTrackResult,
} from "./types";

/** Mock mode is a dev/test convenience only — refuse to run it in production no matter what env vars are set. */
export function mockModeAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

function seedFromString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const MOCK_STAGES: Array<{ status: string; description: string }> = [
  { status: "PICKED_UP", description: "เจ้าหน้าที่รับพัสดุจากร้านค้าแล้ว (ข้อมูลจำลอง)" },
  { status: "IN_TRANSIT", description: "พัสดุอยู่ระหว่างขนส่งไปศูนย์กระจายสินค้า (ข้อมูลจำลอง)" },
  { status: "OUT_FOR_DELIVERY", description: "พัสดุออกไปนำส่งปลายทางแล้ว (ข้อมูลจำลอง)" },
  { status: "DELIVERED", description: "นำส่งสำเร็จ (ข้อมูลจำลอง)" },
];

/**
 * Deterministic fake tracking timeline for a given tracking number — same
 * trackingNo always yields the same simulated stage count, so a test suite
 * can assert on it reliably. Never call this outside mock mode.
 */
export function buildMockTrackResult(carrier: string, trackingNo: string): CarrierTrackResult {
  const seed = seedFromString(`${carrier}:${trackingNo}`);
  const stageCount = 1 + (seed % MOCK_STAGES.length); // 1..4 stages so far
  const now = Date.now();

  const events: CarrierTrackEvent[] = MOCK_STAGES.slice(0, stageCount).map((stage, index) => ({
    status: stage.status,
    description: stage.description,
    // Oldest event first, spaced a few hours apart, ending at "now" for the latest stage.
    occurredAt: new Date(now - (stageCount - 1 - index) * 3 * 60 * 60 * 1000).toISOString(),
  }));

  return { ok: true, trackingNo, events, source: "mock" };
}

/**
 * Fake rate quote so the shipping-fee flow can be exercised before we have real
 * carrier rate docs. The shape of the calculation is intentionally simple and
 * obviously synthetic — it is NOT an approximation of Kerry/Flash pricing, and
 * `source: "mock"` marks it so callers surface a warning instead of billing it.
 */
export function buildMockRateResult(carrier: string, req: CarrierRateRequest): CarrierRateResult {
  const seed = seedFromString(`${carrier}:${req.destProvince ?? "unknown"}`);
  const sameProvince =
    !!req.originProvince && !!req.destProvince && req.originProvince === req.destProvince;

  const base = sameProvince ? 35 : 45 + (seed % 4) * 5; // 45/50/55/60
  const kg = req.totalGrams === null ? 1 : Math.max(1, Math.ceil(req.totalGrams / 1000));
  const weightPart = (kg - 1) * 15;

  return {
    ok: true,
    fee: base + weightPart,
    currency: "THB",
    etaDays: sameProvince ? 1 : 2 + (seed % 2),
    source: "mock",
  };
}

/**
 * Fake shipment creation so createShipment() can exercise end-to-end carrier
 * integration without a real API key/docs. Tracking and external id are stable
 * for the same order/carrier pair. No label URL is returned because there is no
 * pretend PDF endpoint; callers exercise the normal printable fallback instead.
 */
export function buildMockCreateShipmentResult(
  carrier: string,
  req: CarrierCreateShipmentRequest
): CarrierCreateShipmentResult {
  const seed = seedFromString(`${carrier}:${req.idempotencyKey}`);
  const trackingNo = `${carrier}-${String(seed).padStart(10, "0").slice(0, 10)}`;
  return {
    ok: true,
    externalShipmentId: `mock-${carrier.toLowerCase()}-${req.idempotencyKey.slice(0, 8)}`,
    trackingNo,
    labelUrl: null,
    source: "mock",
  };
}
