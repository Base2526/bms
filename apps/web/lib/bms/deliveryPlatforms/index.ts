import { contractBlockedAdapter } from "./blockedAdapter";
import { foodpandaAdapter } from "./foodpanda";
import type { DeliveryPlatformAdapter, DeliveryProvider } from "./types";

const grabfoodAdapter = contractBlockedAdapter(
  "GRABFOOD",
  "https://github.com/grab/grabfood-api-sdk-java",
);
const linemanAdapter = contractBlockedAdapter(
  "LINEMAN",
  "Partner-only contract not available in the public LINE Developers documentation",
);

const ADAPTERS: Readonly<Record<DeliveryProvider, DeliveryPlatformAdapter>> = {
  FOODPANDA: foodpandaAdapter,
  GRABFOOD: grabfoodAdapter,
  LINEMAN: linemanAdapter,
};

export function getDeliveryPlatformAdapter(provider: DeliveryProvider): DeliveryPlatformAdapter {
  return ADAPTERS[provider];
}

export { DELIVERY_CAPABILITIES } from "./capabilities";
export { runDeliveryCall } from "./safeCall";
export type * from "./types";
