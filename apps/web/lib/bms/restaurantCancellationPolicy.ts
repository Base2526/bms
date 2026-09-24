export const RESTAURANT_CANCELLATION_CAUSES = [
  "MERCHANT_OUT_OF_STOCK", "CUSTOMER_CHANGED", "PLATFORM_CANCELLED", "RIDER_UNAVAILABLE",
  "ACCEPTANCE_TIMEOUT", "STORE_CLOSED", "INTEGRATION_FAILURE", "DUPLICATE_FRAUDULENT_EVENT",
] as const;
export type RestaurantCancellationCause = (typeof RESTAURANT_CANCELLATION_CAUSES)[number];

export function isMerchantResponsibleCancellation(cause: RestaurantCancellationCause) {
  return ["MERCHANT_OUT_OF_STOCK", "ACCEPTANCE_TIMEOUT", "STORE_CLOSED", "INTEGRATION_FAILURE"].includes(cause);
}

export function couponEligibilitySubtotal(input: {
  remainingSubtotal: number;
  merchantCancelledSubtotal: number;
}): number {
  return Math.max(0, input.remainingSubtotal) + Math.max(0, input.merchantCancelledSubtotal);
}

export function merchantAbsorbApproval(input: {
  amount: number;
  limit: number;
  hasDistinctManagerApproval: boolean;
}) {
  const amount = Math.max(0, Math.round(input.amount * 100) / 100);
  const limit = Math.max(0, input.limit);
  return {
    allowed: amount <= limit || input.hasDistinctManagerApproval,
    approvalRequired: amount > limit && !input.hasDistinctManagerApproval,
  };
}

export function reconcileRestaurantCancellation(input: {
  paidAmount: number;
  remainingLinesAmount: number;
  merchantAbsorbedAmount: number;
}) {
  const refundAmount = Math.max(0, Math.round((input.paidAmount - input.remainingLinesAmount) * 100) / 100);
  return {
    refundAmount,
    balancedAmount: Math.round((input.remainingLinesAmount - input.merchantAbsorbedAmount + refundAmount) * 100) / 100,
  };
}

