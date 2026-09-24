import { createHash, timingSafeEqual } from "crypto";

import { DELIVERY_CAPABILITIES } from "./capabilities";
import { providerHttpFailure, runDeliveryCall } from "./safeCall";
import type {
  AdapterResult,
  DeliveryAdapterConfig,
  DeliveryAvailabilityInput,
  DeliveryCancelInput,
  DeliveryCommandInput,
  DeliveryPlatformAdapter,
  DeliveryRejectInput,
  NormalizedProviderOrder,
  VerifiedDeliveryWebhook,
} from "./types";

const CONTRACT = "https://developer.foodpanda.com/api-specifications";
const ORDER_STATUSES = new Set(["RECEIVED", "READY_FOR_PICKUP", "DISPATCHED", "CANCELLED", "DELIVERED"]);
const ORDER_TYPES = new Set(["DELIVERY", "PICKUP"]);

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function iso(value: unknown): string | null {
  const candidate = text(value);
  return candidate && !Number.isNaN(Date.parse(candidate)) ? new Date(candidate).toISOString() : null;
}

function invalid<T>(detail: string): AdapterResult<T> {
  return { ok: false, code: "INVALID_RESPONSE", retryable: false, detail };
}

function blocked<T>(detail: string): AdapterResult<T> {
  return { ok: false, code: "CONTRACT_BLOCKED", retryable: false, detail };
}

function source(config: DeliveryAdapterConfig): "sandbox" | "live" {
  return config.environment === "LIVE" ? "live" : "sandbox";
}

function baseUrl(config: DeliveryAdapterConfig): string {
  return config.environment === "LIVE"
    ? "https://foodpanda.partner.deliveryhero.io"
    : "https://sandbox.partner.deliveryhero.io";
}

function chainId(config: DeliveryAdapterConfig): string | null {
  return text(config.config.chainId);
}

function authHeaders(config: DeliveryAdapterConfig): HeadersInit | null {
  if (!config.accessToken) return null;
  return { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" };
}

async function foodpandaJson(
  config: DeliveryAdapterConfig,
  path: string,
  init: RequestInit = {},
): Promise<AdapterResult<unknown>> {
  const headers = authHeaders(config);
  if (!headers) {
    return { ok: false, code: "UNCONFIGURED", retryable: false, detail: "foodpanda access token is missing" };
  }
  return runDeliveryCall(async (signal) => {
    const response = await fetch(`${baseUrl(config)}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
      signal,
    });
    if (!response.ok) return providerHttpFailure(response.status);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) return invalid("foodpanda returned a non-JSON response");
    try {
      return { ok: true, value: await response.json(), source: source(config) };
    } catch {
      return invalid("foodpanda returned malformed JSON");
    }
  });
}

export function normalizeFoodpandaOrder(payload: unknown, config?: DeliveryAdapterConfig): AdapterResult<NormalizedProviderOrder> {
  const root = record(payload);
  if (!root) return invalid("foodpanda order must be an object");
  const client = record(root.client);
  const payment = record(root.payment);
  const providerOrderId = text(root.order_id);
  const providerStoreId = text(client?.store_id);
  const providerStatus = text(root.status);
  const orderType = text(root.order_type);
  const rawItems = Array.isArray(root.items) ? root.items : null;
  const configuredCurrency = config ? text(config.config.currency)?.toUpperCase() : null;
  const currency = text(root.currency)?.toUpperCase() ?? text(payment?.currency)?.toUpperCase() ?? configuredCurrency;

  if (!providerOrderId || !providerStoreId || !providerStatus || !ORDER_STATUSES.has(providerStatus)) {
    return invalid("foodpanda order identity, store or status is invalid");
  }
  if (!orderType || !ORDER_TYPES.has(orderType)) return invalid("foodpanda order_type is invalid");
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return invalid("foodpanda currency must be configured explicitly");
  if (!payment || !rawItems) return invalid("foodpanda payment or items are missing");

  const items = [];
  for (const raw of rawItems) {
    const item = record(raw);
    const pricing = record(item?.pricing);
    const providerLineId = text(item?._id);
    const providerItemId = text(item?.sku);
    const name = text(item?.name);
    const quantity = finite(pricing?.quantity);
    const unitPrice = finite(pricing?.unit_price);
    const discountAmount = finite(item?.discount) ?? 0;
    if (!providerLineId || !providerItemId || !name || !Number.isInteger(quantity) || quantity! <= 0 || unitPrice === null || unitPrice < 0) {
      return invalid("foodpanda order contains an invalid item");
    }
    items.push({
      providerLineId,
      providerItemId,
      providerVariantId: null,
      name,
      quantity: quantity!,
      unitPrice,
      discountAmount: Math.max(discountAmount, 0),
      // The public Partner API order schema does not expose a normalized
      // modifier collection. Do not infer one from arbitrary nested fields.
      modifiers: [],
    });
  }
  if (!items.length) return invalid("foodpanda order has no items");

  const itemSubtotal = finite(payment.sub_total);
  const customerAmount = finite(payment.order_total);
  if (itemSubtotal === null || customerAmount === null || itemSubtotal < 0 || customerAmount < 0) {
    return invalid("foodpanda totals are invalid");
  }

  return {
    ok: true,
    source: config ? source(config) : "fixture",
    value: {
      providerOrderId,
      providerDisplayNumber: text(root.order_code),
      providerStoreId,
      providerStatus,
      orderType: orderType as "DELIVERY" | "PICKUP",
      scheduled: root.isPreorder === true,
      acceptanceDeadlineAt: null,
      preparationTargetAt: null,
      estimatedDeliveryAt: iso(root.accepted_for),
      promisedFor: iso(root.promised_for),
      currency,
      itemSubtotal,
      customerAmount,
      deliveryFee: Math.max(finite(payment.delivery_fee) ?? 0, 0),
      serviceFee: Math.max(finite(payment.service_fee) ?? 0, 0),
      smallOrderFee: Math.max(finite(payment.difference_to_minimum) ?? 0, 0),
      taxAmount: Math.max(finite(payment.total_taxes) ?? 0, 0),
      paymentType: text(payment.type) ?? "UNKNOWN",
      items,
    },
  };
}

function verifyFoodpandaWebhook(input: Parameters<DeliveryPlatformAdapter["verifyWebhook"]>[0]): AdapterResult<VerifiedDeliveryWebhook> {
  const headerName = text(input.config.config.webhookAuthHeader)?.toLowerCase();
  const prefix = typeof input.config.config.webhookAuthPrefix === "string" ? input.config.config.webhookAuthPrefix : "";
  if (!input.config.webhookSecret || !headerName || !/^[a-z0-9-]{1,80}$/.test(headerName)) {
    return blocked("foodpanda webhook header contract must be recorded from Partner Portal before activation");
  }
  const supplied = input.headers.get(headerName);
  const expected = `${prefix}${input.config.webhookSecret}`;
  if (!supplied || supplied.length !== expected.length) {
    return { ok: false, code: "AUTH_FAILED", retryable: false, detail: "foodpanda webhook authentication failed" };
  }
  try {
    if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      return { ok: false, code: "AUTH_FAILED", retryable: false, detail: "foodpanda webhook authentication failed" };
    }
  } catch {
    return { ok: false, code: "AUTH_FAILED", retryable: false, detail: "foodpanda webhook authentication failed" };
  }

  let parsed: unknown;
  try { parsed = JSON.parse(input.rawBody); } catch { return invalid("foodpanda webhook is not valid JSON"); }
  const root = record(parsed);
  const client = record(root?.client);
  const sys = record(root?.sys);
  const providerOrderId = text(root?.order_id);
  const providerStoreId = text(client?.store_id);
  const providerStatus = text(root?.status);
  const occurredAt = iso(sys?.updated_at) ?? iso(sys?.created_at);
  if (!root || !providerOrderId || !providerStoreId || !providerStatus || !ORDER_STATUSES.has(providerStatus) || !occurredAt) {
    return invalid("foodpanda webhook identity, store, status or timestamp is invalid");
  }
  const payloadHash = createHash("sha256").update(input.rawBody).digest("hex");
  // The public webhook schema has no separate event id. Its documented order,
  // status and system update timestamp form a deterministic revision identity;
  // the payload hash distinguishes a conflicting same-timestamp delivery.
  const externalEventId = `order:${providerOrderId}:${occurredAt}:${providerStatus}:${payloadHash.slice(0, 16)}`;
  return {
    ok: true,
    source: source(input.config),
    value: {
      externalEventId,
      eventType: `ORDER.${providerStatus}`,
      providerOrderId,
      providerStoreId,
      providerStatus,
      providerVersion: occurredAt,
      providerOccurredAt: occurredAt,
      payloadHash,
      sanitizedPayload: {
        providerOrderId,
        providerStoreId,
        providerStatus,
        providerDisplayNumber: text(root.order_code),
        orderType: text(root.order_type),
        scheduled: root.isPreorder === true,
        estimatedDeliveryAt: iso(root.accepted_for),
        promisedFor: iso(root.promised_for),
        transportType: text(root.transport_type),
        occurredAt,
      },
    },
  };
}

async function fetchRawOrder(config: DeliveryAdapterConfig, providerOrderId: string): Promise<AdapterResult<unknown>> {
  const chain = chainId(config);
  if (!chain) return { ok: false, code: "UNCONFIGURED", retryable: false, detail: "foodpanda chainId is missing" };
  return foodpandaJson(config, `/v2/chains/${encodeURIComponent(chain)}/orders/${encodeURIComponent(providerOrderId)}`);
}

async function updateOrder(
  config: DeliveryAdapterConfig,
  input: DeliveryCommandInput,
  status: "READY_FOR_PICKUP" | "CANCELLED",
  reasonCode?: string,
): Promise<AdapterResult<{ status: string }>> {
  const chain = chainId(config);
  if (!chain) return { ok: false, code: "UNCONFIGURED", retryable: false, detail: "foodpanda chainId is missing" };
  const current = await fetchRawOrder(config, input.providerOrderId);
  if (!current.ok) return current;
  const root = record(current.value);
  const items = root && Array.isArray(root.items) ? root.items : null;
  if (!items) return invalid("foodpanda order items are missing");
  const body: JsonRecord = { order_id: input.providerOrderId, status, items };
  if (status === "CANCELLED") body.cancellation = { reason: reasonCode };
  const result = await foodpandaJson(
    config,
    `/v2/chains/${encodeURIComponent(chain)}/orders/${encodeURIComponent(input.providerOrderId)}`,
    // The public Partner API does not document an idempotency header. BMS still
    // deduplicates the durable command locally, but must not invent wire headers.
    { method: "PUT", body: JSON.stringify(body) },
  );
  if (!result.ok) return result;
  return { ok: true, value: { status }, source: source(config) };
}

export const foodpandaAdapter: DeliveryPlatformAdapter = {
  provider: "FOODPANDA",
  officialContract: CONTRACT,
  capabilities: DELIVERY_CAPABILITIES.FOODPANDA,
  verifyWebhook: verifyFoodpandaWebhook,
  normalizeOrder: normalizeFoodpandaOrder,
  async fetchOrder(config, input) {
    const result = await fetchRawOrder(config, input.providerOrderId);
    return result.ok ? normalizeFoodpandaOrder(result.value, config) : result;
  },
  async acceptOrder() {
    return blocked("foodpanda public Partner API does not document a distinct accept command");
  },
  async rejectOrder(_config, _input: DeliveryRejectInput) {
    return blocked("foodpanda rejection reason mapping requires market-specific partner confirmation");
  },
  async markReady(config, input) {
    return updateOrder(config, input, "READY_FOR_PICKUP");
  },
  async cancelOrder(config, input: DeliveryCancelInput) {
    return updateOrder(config, input, "CANCELLED", input.reasonCode);
  },
  async pauseStore() {
    return blocked("foodpanda public Partner API does not document a store pause endpoint");
  },
  async setItemAvailability(config, input: DeliveryAvailabilityInput) {
    const chain = chainId(config);
    if (!chain) return { ok: false, code: "UNCONFIGURED", retryable: false, detail: "foodpanda chainId is missing" };
    const result = await foodpandaJson(
      config,
      `/v2/chains/${encodeURIComponent(chain)}/vendors/${encodeURIComponent(input.providerStoreId)}/catalog`,
      {
        method: "PUT",
        body: JSON.stringify({ products: [{ sku: input.providerItemId, active: input.available }] }),
      },
    );
    if (!result.ok) return result;
    return { ok: true, value: { status: "QUEUED" }, source: source(config) };
  },
  async fetchMenu(config, providerStoreId) {
    const chain = chainId(config);
    if (!chain) return { ok: false, code: "UNCONFIGURED", retryable: false, detail: "foodpanda chainId is missing" };
    return foodpandaJson(config, `/v2/chains/${encodeURIComponent(chain)}/vendors/${encodeURIComponent(providerStoreId)}/catalog`);
  },
  async fetchSettlement() {
    return blocked("foodpanda public Partner API does not document settlement statements");
  },
};
