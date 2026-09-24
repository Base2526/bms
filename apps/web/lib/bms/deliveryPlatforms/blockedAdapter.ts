import { DELIVERY_CAPABILITIES } from "./capabilities";
import type {
  AdapterResult,
  DeliveryAvailabilityInput,
  DeliveryCommandInput,
  DeliveryPlatformAdapter,
  DeliveryProvider,
  DeliveryRejectInput,
  DeliveryCancelInput,
  DeliveryPauseInput,
  NormalizedProviderOrder,
  VerifiedDeliveryWebhook,
} from "./types";

const blocked = <T>(provider: DeliveryProvider): AdapterResult<T> => ({
  ok: false,
  code: "CONTRACT_BLOCKED",
  retryable: false,
  detail: `${provider} is disabled until its official partner contract and credentials are reviewed`,
});

export function contractBlockedAdapter(provider: "GRABFOOD" | "LINEMAN", officialContract: string): DeliveryPlatformAdapter {
  return {
    provider,
    officialContract,
    capabilities: DELIVERY_CAPABILITIES[provider],
    verifyWebhook: () => blocked<VerifiedDeliveryWebhook>(provider),
    normalizeOrder: () => blocked<NormalizedProviderOrder>(provider),
    fetchOrder: async () => blocked<NormalizedProviderOrder>(provider),
    acceptOrder: async (_config, _input: DeliveryCommandInput) => blocked(provider),
    rejectOrder: async (_config, _input: DeliveryRejectInput) => blocked(provider),
    markReady: async (_config, _input: DeliveryCommandInput) => blocked(provider),
    cancelOrder: async (_config, _input: DeliveryCancelInput) => blocked(provider),
    pauseStore: async (_config, _input: DeliveryPauseInput) => blocked(provider),
    setItemAvailability: async (_config, _input: DeliveryAvailabilityInput) => blocked(provider),
    fetchMenu: async () => blocked(provider),
    fetchSettlement: async () => blocked(provider),
  };
}
