export type OrderEmailKey = "paid" | "packing" | "shipped" | "completed" | "cancelled" | "returned";

/** PICKUP is read from the persisted order, never inferred from a caller or email recipient. */
export function orderEmailTemplateKey(status: OrderEmailKey, fulfillmentType: string | null): string {
  if (fulfillmentType === "PICKUP" &&
      (status === "paid" || status === "packing" || status === "shipped" || status === "completed")) {
    return `order.pickup.${status}`;
  }
  return `order.${status}`;
}
