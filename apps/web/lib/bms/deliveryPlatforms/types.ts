export const DELIVERY_PROVIDERS = ["GRABFOOD", "LINEMAN", "FOODPANDA"] as const;
export type DeliveryProvider = (typeof DELIVERY_PROVIDERS)[number];
export type DeliveryEnvironment = "SANDBOX" | "LIVE";
export type AdapterSource = "sandbox" | "live" | "fixture";

export type DeliveryCapability =
  | "webhookOrders"
  | "fetchOrder"
  | "listOrders"
  | "acceptOrder"
  | "rejectOrder"
  | "markReady"
  | "markDispatched"
  | "cancelOrder"
  | "pauseStore"
  | "setItemAvailability"
  | "fetchMenu"
  | "fetchSettlement";

export type CapabilityState = "VERIFIED" | "PARTNER_CONFIRMATION_REQUIRED" | "NOT_PUBLIC";

export type DeliveryCapabilities = Readonly<Record<DeliveryCapability, CapabilityState>>;

export type AdapterFailureCode =
  | "UNCONFIGURED"
  | "CONTRACT_BLOCKED"
  | "UNSUPPORTED"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "INVALID_RESPONSE"
  | "INVALID_TRANSPORT_TYPE";

export type AdapterResult<T> =
  | { ok: true; value: T; source: AdapterSource; providerReference?: string; providerAttempts?: number }
  | {
      ok: false;
      code: AdapterFailureCode;
      retryable: boolean;
      detail: string;
      httpStatus?: number;
      providerAttempts?: number;
    };

export interface DeliveryAdapterConfig {
  /** Opaque local identity used only to namespace fleet-wide credential cache entries. */
  integrationId: string | null;
  environment: DeliveryEnvironment;
  clientId: string | null;
  clientSecret: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  webhookSecret: string | null;
  apiVersion: string | null;
  config: Readonly<Record<string, unknown>>;
}

export const DELIVERY_TRANSPORT_TYPES = ["LOGISTICS_DELIVERY", "VENDOR_DELIVERY"] as const;
export type DeliveryTransportType = (typeof DELIVERY_TRANSPORT_TYPES)[number];

export interface DeliveryWebhookInput {
  rawBody: string;
  headers: Headers;
  config: DeliveryAdapterConfig;
}

export interface VerifiedDeliveryWebhook {
  externalEventId: string;
  eventType: string;
  providerOrderId: string;
  providerStoreId: string;
  providerStatus: string;
  providerVersion: string | null;
  providerOccurredAt: string | null;
  payloadHash: string;
  /** Allowlisted operational data only. Never customer, address, phone or raw payload. */
  sanitizedPayload: Readonly<Record<string, unknown>>;
}

export interface DeliveryOrderRef {
  providerOrderId: string;
  providerStoreId: string;
}

export interface DeliveryCommandInput extends DeliveryOrderRef {
  idempotencyKey: string;
}

export interface DeliveryRejectInput extends DeliveryCommandInput {
  reasonCode: string;
}

export interface DeliveryCancelInput extends DeliveryCommandInput {
  reasonCode: string;
  providerLineIds?: readonly string[];
}

export interface DeliveryPauseInput {
  providerStoreId: string;
  paused: boolean;
  pausedUntil?: string | null;
  idempotencyKey: string;
}

export interface DeliveryAvailabilityInput {
  providerStoreId: string;
  providerItemId: string;
  available: boolean;
  idempotencyKey: string;
}

export interface NormalizedProviderOrder {
  providerOrderId: string;
  providerDisplayNumber: string | null;
  providerStoreId: string;
  providerStatus: string;
  providerVersion: string | null;
  providerOccurredAt: string | null;
  transportType: DeliveryTransportType;
  orderType: "DELIVERY" | "PICKUP";
  scheduled: boolean;
  /** Provider-confirmed deadline for the merchant acceptance action, if its contract exposes one. */
  acceptanceDeadlineAt: string | null;
  /** Provider-confirmed time at which kitchen preparation should target readiness. */
  preparationTargetAt: string | null;
  /** Customer-facing estimated delivery time; never reinterpret this as an acceptance deadline. */
  estimatedDeliveryAt: string | null;
  promisedFor: string | null;
  currency: string;
  itemSubtotal: number;
  customerAmount: number;
  deliveryFee: number;
  serviceFee: number;
  smallOrderFee: number;
  taxAmount: number;
  paymentType: string;
  items: readonly NormalizedProviderOrderLine[];
}

export interface NormalizedProviderOrderLine {
  providerLineId: string;
  providerItemId: string;
  providerVariantId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  modifiers: readonly NormalizedProviderModifier[];
}

export interface NormalizedProviderModifier {
  providerModifierId: string;
  name: string;
  quantity: number;
  price: number;
}

export interface DeliveryPlatformAdapter {
  readonly provider: DeliveryProvider;
  readonly officialContract: string;
  readonly capabilities: DeliveryCapabilities;
  verifyWebhook(input: DeliveryWebhookInput): AdapterResult<VerifiedDeliveryWebhook>;
  normalizeOrder(payload: unknown, config?: DeliveryAdapterConfig): AdapterResult<NormalizedProviderOrder>;
  fetchOrder(config: DeliveryAdapterConfig, input: DeliveryOrderRef): Promise<AdapterResult<NormalizedProviderOrder>>;
  acceptOrder(config: DeliveryAdapterConfig, input: DeliveryCommandInput): Promise<AdapterResult<{ status: string }>>;
  rejectOrder(config: DeliveryAdapterConfig, input: DeliveryRejectInput): Promise<AdapterResult<{ status: string }>>;
  markReady(config: DeliveryAdapterConfig, input: DeliveryCommandInput): Promise<AdapterResult<{ status: string }>>;
  markDispatched(config: DeliveryAdapterConfig, input: DeliveryCommandInput): Promise<AdapterResult<{ status: string }>>;
  cancelOrder(config: DeliveryAdapterConfig, input: DeliveryCancelInput): Promise<AdapterResult<{ status: string }>>;
  pauseStore(config: DeliveryAdapterConfig, input: DeliveryPauseInput): Promise<AdapterResult<{ status: string }>>;
  setItemAvailability(config: DeliveryAdapterConfig, input: DeliveryAvailabilityInput): Promise<AdapterResult<{ status: string }>>;
  fetchMenu(config: DeliveryAdapterConfig, providerStoreId: string): Promise<AdapterResult<unknown>>;
  fetchSettlement(config: DeliveryAdapterConfig, period: { from: string; to: string }): Promise<AdapterResult<unknown>>;
}
