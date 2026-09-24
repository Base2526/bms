import type { DeliveryTransportType } from "./types";

export type FoodpandaTransportCommand = "MARK_READY" | "MARK_DISPATCHED" | null;

export function foodpandaCommandForLocalTransition(
  transportType: DeliveryTransportType | null,
  transition: "READY" | "HANDED_OVER",
): { ok: true; commandType: FoodpandaTransportCommand } | { ok: false; code: "INVALID_TRANSPORT_TYPE" } {
  if (!transportType) return { ok: false, code: "INVALID_TRANSPORT_TYPE" };
  if (transportType === "LOGISTICS_DELIVERY") {
    return { ok: true, commandType: transition === "READY" ? "MARK_READY" : null };
  }
  return { ok: true, commandType: transition === "HANDED_OVER" ? "MARK_DISPATCHED" : null };
}
