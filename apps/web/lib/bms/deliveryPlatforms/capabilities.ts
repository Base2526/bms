import type { DeliveryCapabilities, DeliveryProvider } from "./types";

/**
 * Capability truth is conservative: VERIFIED means an official public contract
 * was reviewed. It does not mean credentials, market access or production
 * certification have been granted to this deployment.
 */
export const DELIVERY_CAPABILITIES: Readonly<Record<DeliveryProvider, DeliveryCapabilities>> = {
  FOODPANDA: {
    webhookOrders: "VERIFIED",
    fetchOrder: "VERIFIED",
    listOrders: "VERIFIED",
    acceptOrder: "PARTNER_CONFIRMATION_REQUIRED",
    rejectOrder: "PARTNER_CONFIRMATION_REQUIRED",
    markReady: "VERIFIED",
    cancelOrder: "VERIFIED",
    pauseStore: "NOT_PUBLIC",
    setItemAvailability: "VERIFIED",
    fetchMenu: "VERIFIED",
    fetchSettlement: "NOT_PUBLIC",
  },
  GRABFOOD: {
    webhookOrders: "PARTNER_CONFIRMATION_REQUIRED",
    fetchOrder: "PARTNER_CONFIRMATION_REQUIRED",
    listOrders: "VERIFIED",
    acceptOrder: "VERIFIED",
    rejectOrder: "VERIFIED",
    markReady: "VERIFIED",
    cancelOrder: "VERIFIED",
    pauseStore: "VERIFIED",
    setItemAvailability: "VERIFIED",
    fetchMenu: "PARTNER_CONFIRMATION_REQUIRED",
    fetchSettlement: "NOT_PUBLIC",
  },
  LINEMAN: {
    webhookOrders: "NOT_PUBLIC",
    fetchOrder: "NOT_PUBLIC",
    listOrders: "NOT_PUBLIC",
    acceptOrder: "NOT_PUBLIC",
    rejectOrder: "NOT_PUBLIC",
    markReady: "NOT_PUBLIC",
    cancelOrder: "NOT_PUBLIC",
    pauseStore: "NOT_PUBLIC",
    setItemAvailability: "NOT_PUBLIC",
    fetchMenu: "NOT_PUBLIC",
    fetchSettlement: "NOT_PUBLIC",
  },
};
