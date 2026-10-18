import { createHash } from "node:crypto";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON rejects non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export function requestFingerprint(value: JsonValue): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/;

export function requireIdempotencyKey(value: string | undefined): string {
  const key = value?.trim() ?? "";
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) throw new Error("INVALID_IDEMPOTENCY_KEY");
  return key;
}

export type QuotePricingInput = {
  distanceMeters: number;
  baseFareSatang: number;
  perStartedKmSatang: number;
  minimumFareSatang: number;
  fixedMerchantSubsidySatang: number;
  commissionBps: number;
};

export type QuotePricingResult = {
  billableDistanceMeters: number;
  startedKilometres: number;
  baseFareSatang: number;
  distanceChargeSatang: number;
  grossDeliveryFeeSatang: number;
  customerContributionSatang: number;
  merchantSubsidySatang: number;
  explicitDiscountSatang: 0;
  eligibleCommissionFeeSatang: number;
  commissionSatang: number;
};

function safeNonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`INVALID_${field.toUpperCase()}`);
  return value;
}

function checkedAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new Error("MONEY_OVERFLOW");
  return value;
}

export function calculateQuotePricing(input: QuotePricingInput): QuotePricingResult {
  const distanceMeters = safeNonNegativeInteger(input.distanceMeters, "distance_meters");
  if (distanceMeters === 0) throw new Error("INVALID_DISTANCE_METERS");
  const baseFareSatang = safeNonNegativeInteger(input.baseFareSatang, "base_fare_satang");
  const perStartedKmSatang = safeNonNegativeInteger(input.perStartedKmSatang, "per_started_km_satang");
  const minimumFareSatang = safeNonNegativeInteger(input.minimumFareSatang, "minimum_fare_satang");
  const requestedSubsidy = safeNonNegativeInteger(input.fixedMerchantSubsidySatang, "merchant_subsidy_satang");
  const commissionBps = safeNonNegativeInteger(input.commissionBps, "commission_bps");
  if (commissionBps > 10_000) throw new Error("INVALID_COMMISSION_BPS");

  const startedKilometres = Math.ceil(distanceMeters / 1_000);
  const distanceChargeSatang = safeNonNegativeInteger(
    startedKilometres * perStartedKmSatang,
    "distance_charge_satang",
  );
  const grossDeliveryFeeSatang = Math.max(
    minimumFareSatang,
    checkedAdd(baseFareSatang, distanceChargeSatang),
  );
  const merchantSubsidySatang = Math.min(requestedSubsidy, grossDeliveryFeeSatang);
  const customerContributionSatang = grossDeliveryFeeSatang - merchantSubsidySatang;
  const commissionSatang = Number(
    (BigInt(grossDeliveryFeeSatang) * BigInt(commissionBps) + 5_000n) / 10_000n,
  );

  return {
    billableDistanceMeters: distanceMeters,
    startedKilometres,
    baseFareSatang,
    distanceChargeSatang,
    grossDeliveryFeeSatang,
    customerContributionSatang,
    merchantSubsidySatang,
    explicitDiscountSatang: 0,
    eligibleCommissionFeeSatang: grossDeliveryFeeSatang,
    commissionSatang,
  };
}

export const DELIVERY_STATES = [
  "AWAITING_PAYMENT",
  "AWAITING_MERCHANT_ACCEPTANCE",
  "PREPARING",
  "READY_FOR_DISPATCH",
  "SEARCHING_DRIVER",
  "OFFERED",
  "ASSIGNED",
  "EN_ROUTE_PICKUP",
  "AT_PICKUP",
  "PICKED_UP",
  "IN_TRANSIT",
  "AT_DROPOFF",
  "DELIVERED",
  "COMPLETED",
  "DELIVERY_FAILED",
  "RETURN_REQUESTED",
  "RETURN_APPROVED",
  "RETURN_IN_TRANSIT",
  "RETURNED_TO_MERCHANT",
  "RETURN_REVIEW",
  "RETURN_RESOLVED",
  "MANUAL_DISPATCH_REQUIRED",
  "CANCELLED",
] as const;

export type DeliveryState = typeof DELIVERY_STATES[number];
export type Phase2DeliveryAction =
  | "payment_confirmed"
  | "merchant_accepted"
  | "merchant_ready"
  | "cancel_before_pickup"
  | "merchant_handoff"
  | "complete_delivery"
  | "request_return"
  | "approve_return"
  | "review_return"
  | "resolve_return";

const transitionTargets: Record<Phase2DeliveryAction, Partial<Record<DeliveryState, DeliveryState>>> = {
  payment_confirmed: { AWAITING_PAYMENT: "AWAITING_MERCHANT_ACCEPTANCE" },
  merchant_accepted: { AWAITING_MERCHANT_ACCEPTANCE: "PREPARING" },
  merchant_ready: { PREPARING: "READY_FOR_DISPATCH" },
  cancel_before_pickup: {
    AWAITING_PAYMENT: "CANCELLED",
    AWAITING_MERCHANT_ACCEPTANCE: "CANCELLED",
    PREPARING: "CANCELLED",
    READY_FOR_DISPATCH: "CANCELLED",
    SEARCHING_DRIVER: "CANCELLED",
    OFFERED: "CANCELLED",
    ASSIGNED: "CANCELLED",
    EN_ROUTE_PICKUP: "CANCELLED",
    AT_PICKUP: "CANCELLED",
    MANUAL_DISPATCH_REQUIRED: "CANCELLED",
  },
  merchant_handoff: { AT_PICKUP: "PICKED_UP" },
  complete_delivery: { DELIVERED: "COMPLETED" },
  request_return: { DELIVERY_FAILED: "RETURN_REQUESTED" },
  approve_return: { RETURN_REQUESTED: "RETURN_APPROVED" },
  review_return: { RETURNED_TO_MERCHANT: "RETURN_REVIEW" },
  resolve_return: { RETURN_REVIEW: "RETURN_RESOLVED" },
};

export function nextDeliveryState(state: DeliveryState, action: Phase2DeliveryAction): DeliveryState {
  const target = transitionTargets[action][state];
  if (!target) throw new Error("INVALID_DELIVERY_TRANSITION");
  return target;
}

export type DriverJourneyAction =
  | "start_pickup"
  | "arrive_pickup"
  | "start_delivery"
  | "arrive_dropoff"
  | "deliver_with_pod"
  | "report_failure"
  | "start_return"
  | "arrive_return";

const driverJourneyTargets: Record<DriverJourneyAction, Partial<Record<DeliveryState, DeliveryState>>> = {
  start_pickup: { ASSIGNED: "EN_ROUTE_PICKUP" },
  arrive_pickup: { EN_ROUTE_PICKUP: "AT_PICKUP" },
  start_delivery: { PICKED_UP: "IN_TRANSIT" },
  arrive_dropoff: { IN_TRANSIT: "AT_DROPOFF" },
  deliver_with_pod: { AT_DROPOFF: "DELIVERED" },
  report_failure: {
    PICKED_UP: "DELIVERY_FAILED",
    IN_TRANSIT: "DELIVERY_FAILED",
    AT_DROPOFF: "DELIVERY_FAILED",
  },
  start_return: { RETURN_APPROVED: "RETURN_IN_TRANSIT" },
  arrive_return: { RETURN_IN_TRANSIT: "RETURNED_TO_MERCHANT" },
};

export function nextDriverJourneyState(
  state: DeliveryState,
  action: DriverJourneyAction,
): DeliveryState {
  const target = driverJourneyTargets[action][state];
  if (!target) throw new Error("INVALID_DRIVER_JOURNEY_TRANSITION");
  return target;
}

export type WeeklyWindow = { dayOfWeek: number; opensAt: string; closesAt: string };

export function isOpenAt(windows: WeeklyWindow[], instant: Date, timezone: string): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  const dayOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday ?? "");
  if (dayOfWeek < 0 || !hour || !minute) throw new Error("TIMEZONE_EVALUATION_FAILED");
  const localTime = `${hour}:${minute}`;
  return windows.some((window) =>
    window.dayOfWeek === dayOfWeek && window.opensAt <= localTime && localTime < window.closesAt
  );
}

export type LocationDecisionInput = {
  sequence: number;
  deviceObservedAt: Date;
  receivedAt: Date;
  accuracyM: number;
  mockLocation: boolean;
  previous?: {
    sequence: number;
    deviceObservedAt: Date;
    distanceM: number;
  };
};

export type LocationDecision =
  | { accepted: true; reason: null }
  | { accepted: false; reason: "OUT_OF_ORDER" | "STALE" | "FUTURE_TIME" | "INACCURATE" | "MOCK_SIGNAL" | "IMPOSSIBLE_TRAVEL" };

export function evaluateDriverLocation(input: LocationDecisionInput): LocationDecision {
  if (!Number.isSafeInteger(input.sequence) || input.sequence <= 0) return { accepted: false, reason: "OUT_OF_ORDER" };
  if (input.previous && input.sequence <= input.previous.sequence) return { accepted: false, reason: "OUT_OF_ORDER" };
  const ageMs = input.receivedAt.getTime() - input.deviceObservedAt.getTime();
  if (ageMs > 120_000) return { accepted: false, reason: "STALE" };
  if (ageMs < -30_000) return { accepted: false, reason: "FUTURE_TIME" };
  if (!Number.isFinite(input.accuracyM) || input.accuracyM <= 0 || input.accuracyM > 200) {
    return { accepted: false, reason: "INACCURATE" };
  }
  if (input.mockLocation) return { accepted: false, reason: "MOCK_SIGNAL" };
  if (input.previous) {
    const seconds = (input.deviceObservedAt.getTime() - input.previous.deviceObservedAt.getTime()) / 1_000;
    if (seconds <= 0) return { accepted: false, reason: "OUT_OF_ORDER" };
    if (input.previous.distanceM / seconds > 60) return { accepted: false, reason: "IMPOSSIBLE_TRAVEL" };
  }
  return { accepted: true, reason: null };
}
