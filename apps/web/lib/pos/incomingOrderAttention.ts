export type IncomingOrderAttentionView = {
  id: string;
  status: string;
  deliveryStatus: string | null;
  providerStatus?: string | null;
  providerCommandStatus: string | null;
  acceptanceDeadlineAt?: string | null;
};

const DELIVERY_ATTENTION_STATUSES = new Set([
  "READY",
  "ACTION_REQUIRED",
  "CANCELLED",
  "REJECTED",
  "EXPIRED",
]);

const COMMAND_ATTENTION_STATUSES = new Set(["FAILED", "MANUAL_ACTION_REQUIRED"]);
const PROVIDER_TERMINAL_STATUSES = new Set(["CANCELLED", "REJECTED", "EXPIRED"]);

export type IncomingOrderOperationalState = "ACCEPT" | "PREPARING" | "HANDOFF" | "PROBLEM";
export type IncomingOrderProblemReason =
  | "PROVIDER_TERMINAL"
  | "DELIVERY_ACTION_REQUIRED"
  | "COMMAND_FAILED"
  | "ACCEPTANCE_EXPIRED"
  | "INCONSISTENT_READY";

export function incomingOrderProblemReason(
  order: IncomingOrderAttentionView,
  now = Date.now(),
): IncomingOrderProblemReason | null {
  if (PROVIDER_TERMINAL_STATUSES.has(order.providerStatus ?? "")) return "PROVIDER_TERMINAL";
  if (DELIVERY_ATTENTION_STATUSES.has(order.deliveryStatus ?? "") && order.deliveryStatus !== "READY") {
    return "DELIVERY_ACTION_REQUIRED";
  }
  if (COMMAND_ATTENTION_STATUSES.has(order.providerCommandStatus ?? "")) return "COMMAND_FAILED";
  const deadline = order.acceptanceDeadlineAt ? Date.parse(order.acceptanceDeadlineAt) : Number.NaN;
  if (order.status === "PAID" && Number.isFinite(deadline) && deadline <= now) return "ACCEPTANCE_EXPIRED";
  if (order.status === "PAID" && order.deliveryStatus === "READY") return "INCONSISTENT_READY";
  return null;
}

/**
 * One presentation state for the card, bell and available actions. Provider failures/terminal
 * states deliberately win over the local PAID/PACKING state: showing a green "preparing" chip or
 * an Accept button after the provider has cancelled is operationally worse than showing no action.
 */
export function incomingOrderOperationalState(
  order: IncomingOrderAttentionView,
  now = Date.now(),
): IncomingOrderOperationalState {
  if (incomingOrderProblemReason(order, now)) return "PROBLEM";
  if (order.status === "PAID") return "ACCEPT";
  if (order.deliveryStatus === "READY") return "HANDOFF";
  return "PREPARING";
}

export function incomingOrderNeedsAttention(order: IncomingOrderAttentionView): boolean {
  return incomingOrderOperationalState(order) !== "PREPARING";
}

/**
 * Stable keys for newly actionable transitions. Including the reason means an accepted order can
 * alert again when it later becomes READY or when provider synchronization needs manual recovery.
 */
export function incomingOrderAttentionKeys(orders: readonly IncomingOrderAttentionView[]): string[] {
  return orders.flatMap((order) => {
    const keys: string[] = [];
    const deadline = order.acceptanceDeadlineAt ? Date.parse(order.acceptanceDeadlineAt) : Number.NaN;
    const deadlineExpired = order.status === "PAID" && Number.isFinite(deadline) && deadline <= Date.now();
    const providerTerminal = PROVIDER_TERMINAL_STATUSES.has(order.providerStatus ?? "");
    if (order.status === "PAID" && !deadlineExpired && !providerTerminal
      && !COMMAND_ATTENTION_STATUSES.has(order.providerCommandStatus ?? "")
      && !DELIVERY_ATTENTION_STATUSES.has(order.deliveryStatus ?? "")) {
      keys.push(`${order.id}:accept`);
    }
    if (deadlineExpired) keys.push(`${order.id}:deadline:expired`);
    if (providerTerminal) keys.push(`${order.id}:provider:${order.providerStatus}`);
    if (DELIVERY_ATTENTION_STATUSES.has(order.deliveryStatus ?? "")) {
      keys.push(`${order.id}:delivery:${order.deliveryStatus}`);
    }
    if (COMMAND_ATTENTION_STATUSES.has(order.providerCommandStatus ?? "")) {
      keys.push(`${order.id}:command:${order.providerCommandStatus}`);
    }
    return keys;
  });
}
